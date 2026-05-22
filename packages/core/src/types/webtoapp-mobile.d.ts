/**
 * Ambient type declarations for @webtoapp/mobile.
 *
 * The mobile package is dynamically imported in 07b-mobile.ts so that
 * Capacitor/execa deps are never loaded for desktop-only conversions.
 * Because @webtoapp/mobile peer-depends on @webtoapp/core, adding it as
 * a regular dependency would create a circular dependency. Instead we
 * declare the minimum surface used by the core pipeline here.
 */
declare module "@webtoapp/mobile" {
  export interface MobileConfig {
    appId: string;
    appName: string;
    webDir?: string;
    android?: {
      minSdkVersion?: number;
      targetSdkVersion?: number;
      buildVariant?: "debug" | "release";
      keystorePath?: string;
      keystoreAlias?: string;
      keystorePassword?: string;
    };
    ios?: {
      deploymentTarget?: string;
      developmentTeam?: string;
    };
  }

  export interface MobileBuildResult {
    platform: "android" | "ios";
    success: boolean;
    outputPath?: string;
    error?: string;
    warnings: string[];
  }

  export function buildAndroid(
    projectDir: string,
    config: MobileConfig,
    log?: (msg: string) => void
  ): Promise<MobileBuildResult>;

  export function buildIos(
    projectDir: string,
    config: MobileConfig,
    log?: (msg: string) => void
  ): Promise<MobileBuildResult>;
}
