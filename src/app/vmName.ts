function basename(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  const parts = normalized.split("\\").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function guessVmNameFromVmxPath(vmxPath: string): string {
  const file = basename(vmxPath);
  const withoutExt = file.toLowerCase().endsWith(".vmx") ? file.slice(0, -4) : file;
  if (withoutExt.trim()) return withoutExt;

  const parent = basename(vmxPath.replace(/[\\\/][^\\\/]*$/, ""));
  return parent || "未命名虚拟机";
}

