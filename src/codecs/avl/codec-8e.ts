import { Buffer } from "node:buffer";
import { Spec, Mode, UInt8, UInt16, UInt32, Int32, Bytes } from "destruct-js";

import { ParserError } from "@/lib/errors.js";
import type { Result, AvlRecord, IoElement } from "@/lib/types.js";
import crc16arc from "@/lib/crc16arc.js";

const ioElementsSpec = new Spec()
  .endianness(Mode.BE)
  .field("ioEventId", UInt16)
  .field("numOfIO", UInt16)
  .group(
    "elements",
    new Spec({ lenient: true })
      .endianness(Mode.BE)
      .store("numOfPropertiesN1", UInt16)
      .loop(
        "N1",
        (n1) => {
          return n1.numOfPropertiesN1;
        },
        new Spec({ lenient: true }).endianness(Mode.BE).field("id", UInt16).field("value", UInt8)
      )
      .store("numOfPropertiesN2", UInt16)
      .loop(
        "N2",
        (n2) => {
          return n2.numOfPropertiesN2;
        },
        new Spec({ lenient: true }).endianness(Mode.BE).field("id", UInt16).field("value", UInt16)
      )
      .store("numOfPropertiesN4", UInt16)
      .loop(
        "N4",
        (n4) => {
          return n4.numOfPropertiesN4;
        },
        new Spec({ lenient: true }).endianness(Mode.BE).field("id", UInt16).field("value", UInt32)
      )
      .store("numOfPropertiesN8", UInt16)
      .loop(
        "N8",
        (n8) => n8.numOfPropertiesN8,
        new Spec({ lenient: true })
          .endianness(Mode.BE)
          .field("id", UInt16)
          .field("value", Bytes, {
            size: 8,
            then: (bytes8) => {
              return Number(Buffer.from(bytes8).readBigUInt64BE());
            },
          })
      )
      .store("numOfPropertiesNx", UInt16)
      .loop(
        "NX",
        (nx) => nx.numOfPropertiesNx,
        new Spec({ lenient: true })
          .endianness(Mode.BE)
          .field("id", UInt16)
          .field("length", UInt16)
          .field("value", Bytes, {
            size: (nxFields) => nxFields.length,
            then: (bytesX) => {
              return Number(Buffer.from(bytesX).readBigUInt64BE());
            },
          })
      )
  );

const avlRecordsSpec = new Spec({ lenient: true })
  .endianness(Mode.BE)
  .store("timestamp", Bytes, { size: 8 })
  .derive("timestamp", (fields) => {
    return new Date(Number(Buffer.from(fields.timestamp).readBigUInt64BE())).getTime();
  })
  .field("priority", UInt8)
  .group(
    "gps",
    new Spec({ lenient: true })
      .field("longitude", Int32, { then: (l) => l / 10_000_000 /**10M is the precision */ })
      .field("latitude", Int32, { then: (l) => l / 10_000_000 })
      .field("altitude", UInt16)
      .field("angle", UInt16)
      .field("satellite", UInt8)
      .field("speed", UInt16)
  )
  .group("io", ioElementsSpec)
  .tap((_, readerState) => {
    const ioArray = Object.entries(readerState.result.io.elements).flatMap(([key, value]) => {
      return value;
    });
    readerState.result.io.elements = ioArray;
  })
  .field("numOfData2", UInt8)
  .field("crc16", UInt32);

const codec8EPacketSpec = new Spec({ lenient: true })
  .endianness(Mode.BE)
  .field("preamble", UInt32, { shouldBe: 0x00000000 })
  .field("dataLength", UInt32)
  .field("codecId", UInt8, { shouldBe: 0x8e })
  .field("numOfData1", UInt8)
  .loop(
    "avlRecords",
    (packetFields) => {
      return packetFields.numOfData1;
    },
    avlRecordsSpec
  );

export class Codec8EDecoder {
  /**
   * @description Coded 8 Extended (`0x8E`) in decimal is 142
   */
  public readonly CODEC_8E_DECIMAL = 142;

  // spec definitions...
  public readonly packetSpec = codec8EPacketSpec;

  constructor(private readonly buffer: Buffer) {}

  /**
   * @description This checks if the avl data packet has a valid 4 byte preamble in the 1st 4 bytes
   * as per the documentation here - https://wiki.teltonika-gps.com/view/Teltonika_Data_Sending_Protocols#Codec_8,
   * a `PREAMBLE_ERROR` is thrown otherwise.
   */
  private _checkPreamble(): Result<null> {
    const preamble = this.buffer?.readUInt32BE();
    if (preamble !== 0) {
      return { success: false, error: new ParserError("PREAMBLE_ERROR") };
    }
    return { success: true, data: null };
  }

  private _checkCanDecode(): Result<null> {
    // The byte that represents the codecId is the 9th byte, arrays are 0-indexed and that'll be the 8th byte.
    const codecId = this.buffer?.subarray(8, 9).readUInt8();
    if (codecId !== this.CODEC_8E_DECIMAL) {
      return {
        success: false,
        error: new ParserError(
          "UNSUPPORTED_CODEC",
          "Only codec 8E is supported with this decoder, please try another decoder."
        ),
      };
    }
    return { success: true, data: null };
  }

  private _checkValidCRC16(): Result<null> {
    const FROM_CODEC_ID_OFFSET = 8;
    const TO_NOD2_OFFSET = this.buffer.byteLength - 4;

    const bytesToCalc = this.buffer.subarray(FROM_CODEC_ID_OFFSET, TO_NOD2_OFFSET);
    const calculatedCrc = crc16arc(bytesToCalc);
    const expectedCrc = this.buffer.readInt32BE(this.buffer.byteLength - 4);

    if (calculatedCrc !== expectedCrc)
      return {
        success: false,
        error: new ParserError("CRC_ERROR"),
      };
    return { success: true, data: null };
  }

  /**
   *
   * @description checks where the fields `Number of Data 1` and `Number of Data 2` match.
   */

  private _checkMinAvlSize(): Result<null> {
    const MIN_AVL_PACKET_SIZE = 45; // bytes
    const packetSize = this.buffer.byteLength;
    if (packetSize < MIN_AVL_PACKET_SIZE) {
      return { success: false, error: new ParserError("PACKET_TOO_SMALL") };
    }
    return { success: true, data: null };
  }

  /**
   * @description performs a comprehensive packet validity check before accurate data can be read.
   */
  private _checkPacketHealth(): Result<null> {
    const minSizeResults = this._checkMinAvlSize();
    if (!minSizeResults.success)
      return { success: false, error: new ParserError("PACKET_HEALTH_ERROR", minSizeResults.error.message) };

    const preambleResults = this._checkPreamble();
    if (!preambleResults.success)
      return { success: false, error: new ParserError("PACKET_HEALTH_ERROR", preambleResults.error.message) };

    const canDecodeResults = this._checkCanDecode();
    if (!canDecodeResults.success)
      return { success: false, error: new ParserError("PACKET_HEALTH_ERROR", canDecodeResults.error.message) };

    const crcResults = this._checkValidCRC16();
    if (!crcResults.success)
      return { success: false, error: new ParserError("PACKET_HEALTH_ERROR", crcResults.error.message) };

    return { success: true, data: null };
  }

  public decode() {
    const packetHealth = this._checkPacketHealth();
    if (!packetHealth.success) throw packetHealth.error;

    const decodedPacket = this.packetSpec.read(this.buffer);
    return decodedPacket;
  }
}

export class Codec8EEncoder {
  static readonly __NOT_IMPLEMENTED__ = "Codec 8E Encoder implementation coming soon." as const;
}
