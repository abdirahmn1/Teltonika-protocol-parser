export class ParserError extends Error {
  private static readonly parserErrors = {
    UNSUPPORTED_CODEC: "Unsupported codec in packet.",
    PREAMBLE_ERROR:
      "Invalid preamble or no preamble found, avl packet must have a valid preamble of 4 bytes, please try again.",
    CRC_ERROR: "CRC mismatch, the received data might contain corrupt data.",
    PACKET_TOO_SMALL: "Too small, packet must have a min size of 45 bytes.",
    PACKET_HEALTH_ERROR: "Packet couldn't pass health checks, check the 'cause' below.",
  };

  constructor(readonly code: keyof typeof ParserError.parserErrors, override readonly cause?: string) {
    super(ParserError.parserErrors[code]);
    this.name = "ParserError";
  }
}
