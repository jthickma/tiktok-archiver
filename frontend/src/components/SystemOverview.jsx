import React from 'react';
import { formatBytes, formatDateTime, formatDuration } from '../utils/format';

const toolLabel = {
  ytDlp: 'yt-dlp',
  galleryDl: 'gallery-dl',
  ffmpeg: 'ffmpeg'
};

function OpsItem({ label, value, detail, tone = 'neutral' }) {
  return (
    <div className={`ops-item ${tone}`}>
      <span className="ops-label">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="ops-detail">{detail}</span>}
    </div>
  );
}

export default function SystemOverview({ status }) {
  if (!status || status.offline) return null;

  const disk = status.storage?.disk;
  const hasDiskStats = disk && Number.isFinite(disk.bytesFree) && Number.isFinite(disk.bytesTotal) && disk.bytesTotal > 0;
  const diskUsed = hasDiskStats
    ? disk.bytesTotal - disk.bytesFree
    : null;
  const diskUsedPercent = hasDiskStats
    ? Math.round((diskUsed / disk.bytesTotal) * 100)
    : null;
  const tools = Object.entries(status.tools || {});
  const missingTools = tools.filter(([, available]) => !available).map(([name]) => toolLabel[name] || name);
  const storageBlocked = !status.storage?.dataDirWritable || !status.storage?.downloadsDirWritable;

  return (
    <section className="ops-panel" aria-label="System overview">
      <OpsItem
        label="Worker"
        value={status.queue?.isPaused ? 'Paused' : status.queue?.isProcessing ? 'Running' : 'Idle'}
        detail={`${status.queue?.activeJobIds?.length || 0} active process${status.queue?.activeJobIds?.length === 1 ? '' : 'es'}`}
        tone={status.queue?.isPaused ? 'warn' : 'ok'}
      />
      <OpsItem
        label="Monitor"
        value={status.monitor?.running ? 'Scheduled' : 'Stopped'}
        detail={status.monitor?.nextRunAt ? `Next ${formatDateTime(status.monitor.nextRunAt, 'unknown')}` : 'No next run scheduled'}
        tone={status.monitor?.running ? 'ok' : 'warn'}
      />
      <OpsItem
        label="Tools"
        value={missingTools.length === 0 ? 'Ready' : `${missingTools.length} missing`}
        detail={missingTools.length === 0 ? tools.map(([name]) => toolLabel[name] || name).join(', ') : missingTools.join(', ')}
        tone={missingTools.length === 0 ? 'ok' : 'warn'}
      />
      <OpsItem
        label="Storage"
        value={storageBlocked ? 'Blocked' : 'Writable'}
        detail={diskUsedPercent === null ? `Free ${formatBytes(disk?.bytesFree)}` : `${diskUsedPercent}% used / ${formatBytes(disk.bytesFree)} free`}
        tone={storageBlocked ? 'danger' : 'ok'}
      />
      <OpsItem
        label="Uptime"
        value={formatDuration(status.server?.uptimeSeconds)}
        detail={status.server?.startedAt ? `Started ${formatDateTime(status.server.startedAt, 'unknown')}` : ''}
      />
    </section>
  );
}
