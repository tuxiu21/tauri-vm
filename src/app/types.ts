export type SshConfig = {
  host: string;
  port: number;
  user: string;
};

export type KnownVm = {
  id: string;
  vmxPath: string;
  createdAt: number;
  pinned?: boolean;
  nameOverride?: string;
};

export type VmStopMode = "soft" | "hard";

export type VmPassword = string;

export type Toast = {
  id: string;
  kind: "success" | "error" | "info";
  title: string;
  message?: string;
};
