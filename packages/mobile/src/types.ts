// ─── Shared types ────────────────────────────────────────────────────────────

export interface MobileConfig {
  /** Reverse-domain app ID, e.g. "com.example.myapp" */
  appId: string;
  /** Human-readable app name */
  appName: string;
  /** Relative path to your Vite dist folder, default "dist" */
  webDir?: string;
  /** Android-specific overrides */
  android?: AndroidConfig;
  /** iOS-specific overrides (macOS only) */
  ios?: IosConfig;
}

export interface AndroidConfig {
  /** Minimum Android SDK version (default: 22 = Android 5.1) */
  minSdkVersion?: number;
  /** Target Android SDK version (default: 35 for release builds) */
  targetSdkVersion?: number;
  /** Build variant: "debug" | "release" (default: "debug") */
  buildVariant?: 'debug' | 'release';
  /** Release artifact type: "apk" | "aab" (default: "aab" for release, "apk" for debug) */
  artifactType?: 'apk' | 'aab';
  /** Path to keystore file for release signing */
  keystorePath?: string;
  keystoreAlias?: string;
  keystorePassword?: string;
  /** Key password. Defaults to keystorePassword when omitted. */
  keystoreAliasPassword?: string;
}

export interface IosConfig {
  /** Xcode deployment target, e.g. "13.0" (default: "13.0") */
  deploymentTarget?: string;
  /** Apple development team ID for signing */
  developmentTeam?: string;
}

export interface MobileBuildResult {
  platform: 'android' | 'ios';
  success: boolean;
  outputPath?: string;
  error?: string;
  warnings: string[];
}

export interface DoctorResult {
  platform: 'android' | 'ios';
  ready: boolean;
  checks: DoctorCheck[];
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
  required: boolean;
}
