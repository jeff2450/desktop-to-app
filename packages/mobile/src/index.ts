export { buildAndroid } from './android-builder.js';
export { buildIos } from './ios-builder.js';
export { checkAndroid, checkIos } from './doctor.js';
export { writeCapacitorConfig, patchPackageJsonForMobile } from './capacitor-config.js';
export { stageMobile } from './stage-08-mobile.js';
export type {
  MobileConfig,
  AndroidConfig,
  IosConfig,
  MobileBuildResult,
  DoctorResult,
  DoctorCheck,
} from './types.js';
