import type { ExportEngineInfo } from './exportWorkflowTypes';

export const MOBILE_SERVER_ENGINE = {
  id: 'xmt-mobile-project-doc',
  label: '手机服务端渲染',
  hardware: false,
  transport: 'server',
} as const satisfies ExportEngineInfo;

export function shouldUseMobileServerExport({ mobile, codec, fps, sourceFps }: {
  mobile: boolean;
  codec: string;
  fps: number;
  sourceFps: number;
}): boolean {
  return mobile && codec === 'h264' && fps === sourceFps;
}
