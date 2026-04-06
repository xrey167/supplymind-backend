function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e4e4e7;">
    ${content}
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0 16px;">
    <p style="font-size:12px;color:#a1a1aa;margin:0;">SupplyMind AI</p>
  </div>
</body>
</html>`;
}

export function notificationEmail(
  title: string,
  body: string | null,
  metadata?: Record<string, unknown>,
): string {
  let content = `<h2 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h2>`;
  if (body) {
    content += `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(body)}</p>`;
  }
  if (metadata && Object.keys(metadata).length > 0) {
    content += `<table style="width:100%;font-size:13px;border-collapse:collapse;">`;
    for (const [key, value] of Object.entries(metadata)) {
      content += `<tr><td style="padding:4px 8px 4px 0;color:#71717a;white-space:nowrap;">${escapeHtml(key)}</td><td style="padding:4px 0;">${escapeHtml(String(value))}</td></tr>`;
    }
    content += `</table>`;
  }
  return layout(content);
}

export function budgetWarningEmail(
  workspaceId: string,
  usedPct: number,
  limitUsd: number,
): string {
  const content = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#dc2626;">Budget Warning</h2>
    <p style="margin:0 0 12px;line-height:1.5;">Workspace <strong>${escapeHtml(workspaceId)}</strong> has reached <strong>${usedPct.toFixed(1)}%</strong> of its $${limitUsd.toFixed(2)} budget limit.</p>
    <p style="margin:0;line-height:1.5;">Review your usage to avoid service interruption.</p>`;
  return layout(content);
}

export function taskErrorEmail(taskId: string, error: string): string {
  const content = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#dc2626;">Task Failed</h2>
    <p style="margin:0 0 12px;line-height:1.5;">Task <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;">${escapeHtml(taskId)}</code> encountered an error:</p>
    <pre style="background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;margin:0;">${escapeHtml(error)}</pre>`;
  return layout(content);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
