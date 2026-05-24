import { spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

export const ANDROID_JDK_MAJOR = 17;

export interface JavaRuntime {
  executable: string;
  home?: string;
  major: number;
  version: string;
  source: string;
}

export function configureAndroidJava(): JavaRuntime | null {
  const runtime = findAndroidJava();
  if (runtime?.home) {
    process.env['JAVA_HOME'] = runtime.home;
    prependToEnvPath(process.env, path.join(runtime.home, 'bin'));
  } else if (runtime) {
    delete process.env['JAVA_HOME'];
  }
  return runtime;
}

export function createAndroidJavaEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const runtime = findAndroidJava();

  if (runtime?.home) {
    env['JAVA_HOME'] = runtime.home;
    prependToEnvPath(env, path.join(runtime.home, 'bin'));
  } else if (runtime) {
    delete env['JAVA_HOME'];
  }

  return env;
}

export function findAndroidJava(): JavaRuntime | null {
  for (const home of collectJavaHomeCandidates()) {
    const runtime = inspectJavaHome(home);
    if (runtime && isAndroidJavaCompatible(runtime)) {
      return runtime;
    }
  }

  const currentJava = getCurrentJava();
  if (currentJava && isAndroidJavaCompatible(currentJava)) {
    return currentJava;
  }

  return null;
}

export function getCurrentJava(): JavaRuntime | null {
  return inspectJavaExecutable('java', 'PATH');
}

export function formatJavaRuntime(runtime: JavaRuntime): string {
  const location = runtime.home ? ` at ${runtime.home}` : '';
  return `JDK ${runtime.major}${location} (${firstVersionLine(runtime.version)})`;
}

function isAndroidJavaCompatible(runtime: JavaRuntime): boolean {
  return runtime.major === ANDROID_JDK_MAJOR;
}

function inspectJavaHome(home: string): JavaRuntime | null {
  const normalizedHome = normalizeJavaHome(home);
  const executable = path.join(
    normalizedHome,
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java'
  );

  if (!existsSync(executable)) return null;

  return inspectJavaExecutable(executable, normalizedHome, normalizedHome);
}

function inspectJavaExecutable(
  executable: string,
  source: string,
  home?: string
): JavaRuntime | null {
  const version = readJavaVersion(executable);
  if (!version) return null;

  const major = parseJavaMajor(version);
  if (!major) return null;

  return {
    executable,
    home,
    major,
    version,
    source,
  };
}

function readJavaVersion(executable: string): string | null {
  for (const args of [['--version'], ['-version']]) {
    const result = spawnSync(executable, args, { encoding: 'utf8' });
    if (result.error) continue;

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const output = `${stdout}\n${stderr}`.trim();
    if (output) return output;
  }

  return null;
}

function parseJavaMajor(versionOutput: string): number | null {
  const match =
    versionOutput.match(/(?:openjdk|java)\s+(?:version\s+)?["']?(\d+)(?:\.(\d+))?/i) ??
    versionOutput.match(/version\s+["']?(\d+)(?:\.(\d+))?/i);

  if (!match) return null;

  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : undefined;

  if (!Number.isFinite(first)) return null;
  if (first === 1 && second && Number.isFinite(second)) return second;
  return first;
}

function collectJavaHomeCandidates(): string[] {
  const candidates: string[] = [];
  const add = (candidate?: string | null) => {
    if (!candidate) return;
    candidates.push(candidate);
  };
  const addChildren = (parent?: string | null) => {
    if (!parent || !existsSync(parent)) return;

    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(parent, entry.name));
      }
    }
  };

  add(process.env['JAVA_HOME']);
  add(process.env['JDK_HOME']);

  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const localAppData = process.env['LOCALAPPDATA'];

    add(path.join(programFiles, 'Java', 'jdk-17'));
    add(path.join(programFiles, 'Android', 'Android Studio', 'jbr'));
    addChildren(path.join(programFiles, 'Java'));
    addChildren(path.join(programFiles, 'Eclipse Adoptium'));
    addChildren(path.join(programFiles, 'Microsoft'));
    addChildren(programFilesX86 ? path.join(programFilesX86, 'Java') : null);
    addChildren(localAppData ? path.join(localAppData, 'Programs', 'Eclipse Adoptium') : null);
  } else if (process.platform === 'darwin') {
    add('/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home');
    add('/opt/homebrew/opt/openjdk@17');
    add('/usr/local/opt/openjdk@17');
    addChildren('/Library/Java/JavaVirtualMachines');
  } else {
    add('/usr/lib/jvm/java-17-openjdk');
    add('/usr/lib/jvm/java-17-openjdk-amd64');
    addChildren('/usr/lib/jvm');
  }

  return [...new Set(candidates.map((candidate) => normalizeJavaHome(candidate)))];
}

function normalizeJavaHome(candidate: string): string {
  let normalized = path.normalize(candidate);

  if (path.basename(normalized).toLowerCase() === 'bin') {
    normalized = path.dirname(normalized);
  }

  if (process.platform === 'darwin' && normalized.endsWith('.jdk')) {
    normalized = path.join(normalized, 'Contents', 'Home');
  }

  return normalized;
}

function prependToEnvPath(env: NodeJS.ProcessEnv, dir: string): void {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  const entries = currentPath.split(path.delimiter).filter(Boolean);

  if (!entries.some((entry) => path.normalize(entry).toLowerCase() === path.normalize(dir).toLowerCase())) {
    env[pathKey] = [dir, ...entries].join(path.delimiter);
  }
}

function firstVersionLine(version: string): string {
  return version.split(/\r?\n/).find(Boolean) ?? version;
}
