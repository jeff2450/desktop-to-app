"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { conversionsApi } from "@/lib/api-client";
import { 
  Card, 
  CardContent, 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  GitBranch,
  FileArchive, 
  ChevronRight, 
  ChevronLeft, 
  Rocket,
  Info,
  Check,
  CreditCard,
  Loader2,
  AlertCircle,
  ImagePlus,
  X,
  Key,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

const STEPS = ["Source", "Config", "Review"];

type ConversionMode = "online";
type SourceType = "github" | "upload";

interface FormData {
  name: string;
  sourceType: SourceType;
  sourceUrl: string;
  appId: string;
  mode: ConversionMode;
  targets: string[];
}

interface SourceOptionProps {
  icon: React.ElementType;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}

interface TargetCheckboxProps {
  label: string;
  value: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
}

interface ReviewItemProps {
  label: string;
  value: string;
}

const APP_ID_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/;

export default function NewJobPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState<FormData>({
    name: "",
    sourceType: "github",
    sourceUrl: "",
    appId: "",
    mode: "online",
    targets: ["linux"],
  });

  const [androidSigning, setAndroidSigning] = useState({
    enabled: false,
    buildVariant: "release" as "debug" | "release",
    artifactType: "aab" as "apk" | "aab",
    keystoreAlias: "",
    keystorePassword: "",
    keystoreAliasPassword: "",
  });
  const [keystoreFile, setKeystoreFile] = useState<File | null>(null);
  const keystoreInputRef = useRef<HTMLInputElement>(null);

  const nextStep = () => {
    setFieldError(null);

    if (step === 0) {
      if (formData.sourceType === "github" && !formData.sourceUrl.trim()) {
        setFieldError("Please enter a GitHub repository URL.");
        return;
      }
      if (formData.sourceType === "upload" && !selectedFile) {
        setFieldError("Please select a ZIP file to upload.");
        return;
      }
    }

    if (step === 1) {
      if (!APP_ID_RE.test(formData.appId.trim())) {
        setFieldError("App ID must be in reverse-domain format, e.g. com.example.myapp");
        return;
      }
      if (formData.targets.length === 0) {
        setFieldError("Please select at least one target platform.");
        return;
      }
      if (formData.targets.includes("android") && androidSigning.enabled) {
        if (!keystoreFile) {
          setFieldError("Please upload your Android release keystore file (.keystore or .jks).");
          return;
        }
        if (!androidSigning.keystoreAlias.trim()) {
          setFieldError("Please enter your keystore key alias.");
          return;
        }
        if (!androidSigning.keystorePassword.trim()) {
          setFieldError("Please enter your keystore password.");
          return;
        }
      }
    }

    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const prevStep = () => {
    setFieldError(null);
    setStep(s => Math.max(s - 1, 0));
  };

  const toggleTarget = (target: string) => {
    setFormData(prev => ({
      ...prev,
      targets: prev.targets.includes(target)
        ? prev.targets.filter(t => t !== target)
        : [...prev.targets, target]
    }));
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith(".zip")) {
      setFieldError("Only .zip files are accepted.");
      return;
    }
    setFieldError(null);
    setSelectedFile(file);
    if (!formData.name) {
      setFormData(prev => ({
        ...prev,
        name: file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase())
      }));
    }
  };

  const handleIconSelect = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["png", "jpg", "jpeg", "ico"].includes(ext)) {
      setFieldError("Icon must be a PNG, JPG, or ICO file.");
      return;
    }

    if (ext === "ico") {
      setFieldError(null);
      setIconFile(file);
      const url = URL.createObjectURL(file);
      setIconPreview(url);
    } else {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        if (img.width < 256 || img.height < 256) {
          setFieldError(`Icon must be at least 256x256 pixels. Uploaded image is ${img.width}x${img.height}px.`);
          URL.revokeObjectURL(objectUrl);
        } else {
          setFieldError(null);
          setIconFile(file);
          setIconPreview(objectUrl);
        }
      };
      img.onerror = () => {
        setFieldError("Invalid image file. Failed to load.");
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    }
  };

  const clearIcon = () => {
    setIconFile(null);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconPreview(null);
    if (iconInputRef.current) iconInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    setLoading(true);
    setSubmitError(null);
    setShowUpgradePrompt(false);

    try {
      const appName = formData.name.trim() || "Untitled App";
      const appId = formData.appId.trim();
      const config: any = {
        name: appName,
        appId,
        mode: formData.mode,
        targets: formData.targets,
      };

      if (formData.targets.includes("android") && androidSigning.enabled) {
        config.mobile = {
          android: {
            buildVariant: androidSigning.buildVariant,
            artifactType: androidSigning.artifactType,
            keystoreAlias: androidSigning.keystoreAlias.trim() || undefined,
            keystorePassword: androidSigning.keystorePassword || undefined,
            keystoreAliasPassword: androidSigning.keystoreAliasPassword || androidSigning.keystorePassword || undefined,
          }
        };
      }

      const isMultipart = formData.sourceType === "upload" || !!iconFile || !!keystoreFile;

      let res;
      if (isMultipart) {
        const data = new FormData();
        if (formData.sourceType === "upload") {
          data.append("archive", selectedFile!);
        } else {
          data.append("sourceRepo", formData.sourceUrl.trim());
          config.sourceRepo = formData.sourceUrl.trim();
        }
        data.append("config", JSON.stringify(config));
        data.append("platforms", JSON.stringify(formData.targets));
        if (iconFile) data.append("icon", iconFile);
        if (keystoreFile) data.append("keystore", keystoreFile);
        res = await conversionsApi.create(data);
      } else {
        res = await conversionsApi.create({
          sourceRepo: formData.sourceUrl.trim(),
          platforms: formData.targets,
          config,
        });
      }
      
      if (res.data) {
        router.push(`/jobs/${res.data.id}`);
      } else if (res.error) {
        setSubmitError(res.error);
        setShowUpgradePrompt(isUsageLimitError(res.error));
      }
    } catch {
      setSubmitError("Failed to start conversion. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020514]">
      <TopBar title="New Conversion" />
      
      <div className="p-8 max-w-3xl mx-auto">
        {/* Progress Stepper */}
        <div className="flex items-center justify-between mb-12">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all",
                  step === i ? "bg-[#2b72f5] border-[#2b72f5] text-white shadow-[0_0_15px_rgba(43,114,245,0.5)]" : 
                  step > i ? "bg-[#030720] border-[#8d99c4]/15 text-[#2b72f5]" : "bg-[#020514] border-[#8d99c4]/15 text-[#8d99c4]/60"
                )}>
                  {step > i ? <Check className="w-5 h-5" /> : i + 1}
                </div>
                <span className={cn("text-xs font-bold uppercase tracking-widest", step === i ? "text-white" : "text-[#8d99c4]/60")}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("h-[2px] flex-1 mx-4 bg-[#8d99c4]/10 transition-colors", step > i && "bg-[#2b72f5]/50")} />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Inline field error */}
          {fieldError && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3 text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {fieldError}
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <Card className={cn(
              "border p-5",
              showUpgradePrompt ? "bg-amber-500/10 border-amber-500/30" : "bg-rose-500/10 border-rose-500/30"
            )}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className={cn("text-sm font-bold", showUpgradePrompt ? "text-amber-200" : "text-red-200")}>
                    {showUpgradePrompt ? "Free conversion used" : "Conversion failed"}
                  </p>
                  <p className="mt-1 text-sm text-[#dee3f7]/85">{submitError}</p>
                </div>
                {showUpgradePrompt && (
                  <Button
                    type="button"
                    onClick={() => router.push("/billing")}
                    className="shrink-0 bg-[#2b72f5] hover:bg-[#1a5ecc] text-white rounded-xl"
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Upgrade
                  </Button>
                )}
              </div>
            </Card>
          )}
          
          {/* STEP 1: SOURCE */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SourceOption 
                  icon={GitBranch}
                  label="GitHub Repo" 
                  description="Point to a public or private repository" 
                  active={formData.sourceType === "github"}
                  onClick={() => { setFieldError(null); setFormData(f => ({ ...f, sourceType: "github" })); }}
                />
                <SourceOption 
                  icon={FileArchive}
                  label="Upload ZIP" 
                  description="Upload a source archive (max 200 MB)" 
                  active={formData.sourceType === "upload"}
                  onClick={() => { setFieldError(null); setFormData(f => ({ ...f, sourceType: "upload" })); }}
                />
              </div>

              {formData.sourceType === "github" ? (
                <div className="space-y-2">
                  <Label className="text-[#8d99c4]">Repository URL</Label>
                  <Input 
                    id="source-url"
                    placeholder="https://github.com/user/repo" 
                    className="bg-[#030720]/50 border-[#8d99c4]/15 h-12 rounded-xl text-white placeholder-[#8d99c4]/40 focus:ring-[#2b72f5]"
                    value={formData.sourceUrl}
                    onChange={(e) => setFormData(f => ({ ...f, sourceUrl: e.target.value }))}
                  />
                  <p className="text-[10px] text-[#8d99c4]/65 flex items-center gap-1"><Info className="w-3 h-3" /> Must be a valid GitHub URL</p>
                </div>
              ) : (
                <div 
                  onClick={() => document.getElementById("zip-file-input")?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                  className="border-2 border-dashed border-[#8d99c4]/15 rounded-2xl p-12 text-center bg-[#030720]/30 hover:bg-[#030720]/50 transition-colors cursor-pointer group"
                >
                  <input 
                    type="file" 
                    id="zip-file-input" 
                    accept=".zip" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />
                  <FileArchive className={cn("w-12 h-12 mx-auto mb-4 transition-colors", selectedFile ? "text-[#2b72f5]" : "text-[#8d99c4]/50 group-hover:text-[#2b72f5]")} />
                  <p className="text-[#dee3f7]/85 font-medium">
                    {selectedFile ? selectedFile.name : "Click to select or drag and drop"}
                  </p>
                  <p className="text-[#8d99c4] text-xs mt-1">
                    {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : ".zip files only · max 200 MB"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: CONFIGURATION */}
          {step === 1 && (
            <Card className="bg-[#030720]/50 border-[#8d99c4]/15">
              <CardContent className="pt-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="app-name" className="text-[#8d99c4]">App Name</Label>
                    <Input 
                      id="app-name"
                      placeholder="My Amazing App" 
                      className="bg-[#020514] border-[#8d99c4]/15 text-white"
                      value={formData.name}
                      onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-id" className="text-[#8d99c4]">App ID (Bundle ID)</Label>
                    <Input 
                      id="app-id"
                      placeholder="com.example.myapp" 
                      className="bg-[#020514] border-[#8d99c4]/15 text-white font-mono"
                      value={formData.appId}
                      onChange={(e) => setFormData(f => ({ ...f, appId: e.target.value }))}
                    />
                    <p className="text-[10px] text-[#8d99c4] flex items-center gap-1">
                      <Info className="w-3 h-3" /> Reverse-domain format, e.g. com.acme.app
                    </p>
                  </div>
                </div>

                {/* App Icon Upload */}
                <div className="space-y-3">
                  <Label className="text-[#8d99c4]">App Icon <span className="text-[#8d99c4]/50 font-normal">(optional)</span></Label>
                  <div
                    onClick={() => !iconFile && iconInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleIconSelect(file);
                    }}
                    className={cn(
                      "relative flex items-center gap-5 p-4 rounded-xl border-2 transition-all",
                      iconFile
                        ? "border-[#2b72f5]/50 bg-[#2b72f5]/5 cursor-default"
                        : "border-dashed border-[#8d99c4]/15 bg-[#020514] hover:border-[#2b72f5]/30 hover:bg-[#030720]/50 cursor-pointer"
                    )}
                  >
                    <input
                      ref={iconInputRef}
                      type="file"
                      id="icon-file-input"
                      accept=".png,.jpg,.jpeg,.ico"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleIconSelect(file);
                      }}
                    />
                    {iconFile && iconPreview ? (
                      <>
                        <div className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={iconPreview}
                            alt="App icon preview"
                            className="w-16 h-16 rounded-xl object-cover border border-[#8d99c4]/20 shadow-lg"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{iconFile.name}</p>
                          <p className="text-xs text-[#8d99c4]/70">{(iconFile.size / 1024).toFixed(1)} KB</p>
                          <p className="text-[10px] text-emerald-400 mt-1">✓ Will be used as application icon</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearIcon(); }}
                          className="shrink-0 p-1.5 rounded-lg text-[#8d99c4] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          aria-label="Remove icon"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-xl border-2 border-dashed border-[#8d99c4]/10 flex items-center justify-center shrink-0">
                          <ImagePlus className="w-6 h-6 text-[#8d99c4]/40" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#8d99c4]">Upload app icon</p>
                          <p className="text-xs text-[#8d99c4]/60 mt-0.5">PNG, JPG, or ICO · 512×512 px recommended</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <Label className="text-[#8d99c4]">Target Platforms</Label>
                  <div className="flex flex-wrap gap-6 p-4 bg-[#020514] border border-[#8d99c4]/15 rounded-xl">
                    <TargetCheckbox label="Windows" value="windows" checked={formData.targets.includes("windows")} onCheckedChange={() => toggleTarget("windows")} />
                    <TargetCheckbox label="Linux"   value="linux"   checked={formData.targets.includes("linux")}   onCheckedChange={() => toggleTarget("linux")} />
                    <TargetCheckbox label="macOS"   value="mac"     checked={formData.targets.includes("mac")}     onCheckedChange={() => toggleTarget("mac")} />
                    <TargetCheckbox label="Android" value="android" checked={formData.targets.includes("android")} onCheckedChange={() => toggleTarget("android")} />
                    <TargetCheckbox label="iOS"     value="ios"     checked={formData.targets.includes("ios")}     onCheckedChange={() => toggleTarget("ios")} />
                  </div>
                  {formData.targets.includes("ios") && (
                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                      <Info className="w-3 h-3" /> iOS builds require macOS — the pipeline will skip this target on Linux/Windows runners.
                    </p>
                  )}
                  {formData.targets.includes("mac") && (
                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                      <Info className="w-3 h-3" /> macOS (.dmg) builds require a macOS worker. This target will be skipped if the pipeline runs on a Linux or Windows machine.
                    </p>
                  )}

                  {formData.targets.includes("android") && (
                    <div className="mt-4 p-4 border border-[#8d99c4]/15 bg-[#020514]/60 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="enable-android-signing"
                          checked={androidSigning.enabled}
                          onCheckedChange={(checked) =>
                            setAndroidSigning((prev) => ({
                              ...prev,
                              enabled: !!checked,
                            }))
                          }
                        />
                        <label
                          htmlFor="enable-android-signing"
                          className="text-sm font-semibold text-white cursor-pointer select-none"
                        >
                          Enable Android Release Signing (for Play Store deployment)
                        </label>
                      </div>

                      {androidSigning.enabled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#8d99c4]/10 animate-in fade-in slide-in-from-top-2 duration-200">
                          <div className="space-y-2 md:col-span-2">
                            <Label className="text-[#8d99c4] flex items-center gap-1.5">
                              <Key className="w-4 h-4 text-[#2b72f5]" /> Keystore File (.keystore or .jks)
                            </Label>
                            <div
                              onClick={() => !keystoreFile && keystoreInputRef.current?.click()}
                              className={cn(
                                "relative flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer",
                                keystoreFile
                                  ? "border-[#2b72f5]/50 bg-[#2b72f5]/5"
                                  : "border-dashed border-[#8d99c4]/15 bg-[#020514] hover:border-[#2b72f5]/30"
                              )}
                            >
                              <input
                                ref={keystoreInputRef}
                                type="file"
                                accept=".keystore,.jks"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) setKeystoreFile(file);
                                }}
                              />
                              <div className="flex items-center gap-2 overflow-hidden">
                                <FileArchive className={cn("w-5 h-5 flex-shrink-0", keystoreFile ? "text-[#2b72f5]" : "text-[#8d99c4]/40")} />
                                <span className="text-sm text-[#dee3f7]/85 truncate">
                                  {keystoreFile ? keystoreFile.name : "Select or drag and drop your keystore file"}
                                </span>
                              </div>
                              {keystoreFile && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setKeystoreFile(null);
                                    if (keystoreInputRef.current) keystoreInputRef.current.value = "";
                                  }}
                                  className="p-1 rounded text-[#8d99c4] hover:text-rose-400 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="keystore-alias" className="text-[#8d99c4]">Key Alias</Label>
                            <Input
                              id="keystore-alias"
                              placeholder="my-key-alias"
                              className="bg-[#020514] border-[#8d99c4]/15 text-white"
                              value={androidSigning.keystoreAlias}
                              onChange={(e) =>
                                setAndroidSigning((prev) => ({
                                  ...prev,
                                  keystoreAlias: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="keystore-password" className="text-[#8d99c4]">Keystore Password</Label>
                            <Input
                              id="keystore-password"
                              type="password"
                              placeholder="••••••••"
                              className="bg-[#020514] border-[#8d99c4]/15 text-white"
                              value={androidSigning.keystorePassword}
                              onChange={(e) =>
                                setAndroidSigning((prev) => ({
                                  ...prev,
                                  keystorePassword: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="keystore-alias-password" className="text-[#8d99c4]">
                              Key Password <span className="text-[#8d99c4]/50 text-xs font-normal">(optional)</span>
                            </Label>
                            <Input
                              id="keystore-alias-password"
                              type="password"
                              placeholder="Leave blank to use keystore password"
                              className="bg-[#020514] border-[#8d99c4]/15 text-white"
                              value={androidSigning.keystoreAliasPassword}
                              onChange={(e) =>
                                setAndroidSigning((prev) => ({
                                  ...prev,
                                  keystoreAliasPassword: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="build-variant" className="text-[#8d99c4]">Build Variant</Label>
                            <select
                              id="build-variant"
                              className="w-full h-10 px-3 rounded-md bg-[#020514] border border-[#8d99c4]/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#2b72f5]"
                              value={androidSigning.buildVariant}
                              onChange={(e) =>
                                setAndroidSigning((prev) => ({
                                  ...prev,
                                  buildVariant: e.target.value as "debug" | "release",
                                }))
                              }
                            >
                              <option value="release">Release (Production)</option>
                              <option value="debug">Debug</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="artifact-type" className="text-[#8d99c4]">Artifact Type</Label>
                            <select
                              id="artifact-type"
                              className="w-full h-10 px-3 rounded-md bg-[#020514] border border-[#8d99c4]/15 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#2b72f5]"
                              value={androidSigning.artifactType}
                              onChange={(e) =>
                                setAndroidSigning((prev) => ({
                                  ...prev,
                                  artifactType: e.target.value as "apk" | "aab",
                                }))
                              }
                            >
                              <option value="aab">AAB (Google Play Store Bundle)</option>
                              <option value="apk">APK (Direct Installation / Sharing)</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 3: REVIEW */}
          {step === 2 && (
            <Card className="bg-[#030720]/50 border-[#8d99c4]/15 overflow-hidden">
              <div className="bg-[#2b72f5]/15 p-6 border-b border-[#2b72f5]/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#2b72f5]/25 rounded-2xl flex items-center justify-center text-[#2b72f5]">
                    <Rocket className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold">Ready to Launch</h3>
                    <p className="text-[#2b72f5]/80 text-xs">Review your configuration before starting.</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-6 space-y-4">
                <ReviewItem label="App Name" value={formData.name || "Untitled App"} />
                <ReviewItem label="App ID" value={formData.appId} />
                <ReviewItem label="Source" value={formData.sourceType === "github" ? formData.sourceUrl : selectedFile?.name ?? "ZIP Upload"} />
                <ReviewItem label="Targets" value={formData.targets.join(", ").toUpperCase()} />
                <ReviewItem label="App Icon" value={iconFile ? `✓ ${iconFile.name}` : "Auto-detect from source"} />
                {formData.targets.includes("android") && (
                  <ReviewItem 
                    label="Android Signing" 
                    value={androidSigning.enabled ? `Enabled (${androidSigning.artifactType.toUpperCase()} - ${androidSigning.buildVariant})` : "Disabled"} 
                  />
                )}
                
                <div className="mt-8 p-4 bg-[#020514] rounded-xl border border-[#8d99c4]/15">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-[#2b72f5]" />
                    <span className="text-sm font-bold text-white">Estimated Build Time</span>
                  </div>
                  <p className="text-sm text-[#8d99c4]">
                    Based on {formData.targets.length} target platform{formData.targets.length !== 1 ? "s" : ""}, this build will take approximately {formData.targets.length * 2}–{formData.targets.length * 2 + 3} minutes.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4">
            <Button 
              variant="ghost" 
              onClick={prevStep} 
              className={cn("text-[#8d99c4] hover:text-white hover:bg-[#030720]/50 rounded-xl", step === 0 && "invisible")}
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            {step < STEPS.length - 1 ? (
              <Button 
                id="step-next"
                onClick={nextStep}
                className="bg-white text-[#020514] hover:bg-[#dee3f7] rounded-xl px-8"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button 
                id="start-conversion"
                onClick={handleSubmit} 
                disabled={loading}
                className="bg-[#2b72f5] hover:bg-[#1a5ecc] text-white rounded-xl px-8 shadow-[0_0_20px_rgba(43,114,245,0.3)]"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Start Conversion <Rocket className="w-4 h-4" />
                  </span>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceOption({ icon: Icon, label, description, active, onClick }: SourceOptionProps) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "p-6 border-2 rounded-2xl cursor-pointer transition-all group",
        active ? "bg-[#2b72f5]/15 border-[#2b72f5] ring-1 ring-[#2b72f5]/50 shadow-[0_0_20px_rgba(43,114,245,0.1)]" : 
        "bg-[#030720]/30 border-[#8d99c4]/15 hover:border-[#2b72f5]/30"
      )}
    >
      <Icon className={cn("w-8 h-8 mb-4 transition-colors", active ? "text-[#2b72f5]" : "text-[#8d99c4]/60 group-hover:text-[#2b72f5]/70")} />
      <h3 className={cn("font-bold text-sm", active ? "text-white" : "text-[#8d99c4]")}>{label}</h3>
      <p className="text-xs text-[#8d99c4]/70 mt-1">{description}</p>
    </div>
  );
}

function TargetCheckbox({ label, value, checked, onCheckedChange, disabled }: TargetCheckboxProps) {
  return (
    <div className={cn("flex items-center space-x-2", disabled && "opacity-40 cursor-not-allowed")}>
      <Checkbox id={`target-${value}`} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label htmlFor={`target-${value}`} className="text-sm font-medium text-[#dee3f7]/85 cursor-pointer uppercase tracking-tight">
        {label}
        {disabled && <span className="ml-1 text-[9px] text-[#fcc8b7] normal-case tracking-normal">Pro</span>}
      </label>
    </div>
  );
}

function ReviewItem({ label, value }: ReviewItemProps) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-[#8d99c4]/10 last:border-0">
      <span className="text-xs font-bold text-[#8d99c4]/80 uppercase tracking-widest">{label}</span>
      <span className="text-sm font-medium text-white text-right max-w-xs truncate">{value}</span>
    </div>
  );
}

function isUsageLimitError(error: string): boolean {
  const normalized = error.toLowerCase();
  return normalized.includes("free conversion") || normalized.includes("monthly job limit");
}
