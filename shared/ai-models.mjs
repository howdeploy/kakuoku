// GhostMetal /v1/models, 2026-11-01: text output, image input, and tool support.
export const aiModels = [
  { id: 'glm-5.3-long', label: 'GLM 5.3 Long · 1M', vision: true },
  { id: 'glm-5.3', label: 'GLM 5.3 · 256K', vision: true },
  { id: 'qwen-3.8-next', label: 'Qwen 3.8 Next · 512K', vision: true },
];

export function imageModel(config) {
  return config.visionModel === 'off' ? null : config.visionModel === 'same' ? config.model : config.visionModel;
}
