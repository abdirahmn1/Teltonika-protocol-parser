import { ParserError } from "@/lib/errors.js";

export type Result<T, B extends boolean = false> = B extends true
  ? { success: true; data: T }
  : { success: true; data: T } | { success: false; error: ParserError };

export type IoElement = {};
export type AvlRecord = {
  timestamp: Date;
  priority: number;
  gps: {
    longitude: number;
    latitude: number;
    altitude: number;
    angle: number;
    satellites: number;
    speed: number;
  };
  ioEventId: number;
  ioCount: number;
  ioElements: IoElement[];
};
