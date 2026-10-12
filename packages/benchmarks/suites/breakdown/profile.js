// 按采样时间而不是调用次数汇总自身耗时，保留 idle 和 GC，避免放大热点占比
// V8 profile 不能区分内核等待、CPU 抢占和线程迁移，不能用它单独归因操作系统
export function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const frames = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
    const frame = nodes.get(profile.samples[index]);
    if (!frame) continue;
    const key = `${frame.url}:${frame.lineNumber}:${frame.functionName}`;
    const row = frames.get(key) ?? {
      function: frame.functionName || "(anonymous)",
      url: frame.url,
      line: frame.lineNumber + 1,
      sampledUs: 0,
      samples: 0,
    };
    row.sampledUs += profile.timeDeltas?.[index] ?? 0;
    row.samples++;
    frames.set(key, row);
  }
  const rows = [...frames.values()];
  const sampledUs = rows.reduce((sum, row) => sum + row.sampledUs, 0);
  return {
    sampledUs,
    topSelf: rows
      .toSorted((a, b) => b.sampledUs - a.sampledUs)
      .slice(0, 30)
      .map((row) => ({ ...row, percent: sampledUs ? (row.sampledUs * 100) / sampledUs : null })),
  };
}
