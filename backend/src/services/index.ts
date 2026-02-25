// Business logic and service layer
// Handles stream calculations and data processing

export {
  StreamLifecycleService,
  toBigIntOrNull,
  toObjectOrNull,
} from "./stream-lifecycle-service.js";

export {
  BatchMetadataService,
  type BatchMetadataResponse,
  type StreamMetadataResult,
  type StreamMetadataError,
} from "./batch-metadata.service.js";
