export function parseSRT(text) {
  const items = [];
  const blocks = text.trim().replace(/\r\n/g, '\n').split(/\n\n+/);
  blocks.forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const timeLineIndex = lines[0].includes('-->') ? 0 : 1;
      const timeMatch = lines[timeLineIndex] ? lines[timeLineIndex].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/) : null;
      if (timeMatch) {
        const startMs = (+timeMatch[1]*3600 + +timeMatch[2]*60 + +timeMatch[3])*1000 + +timeMatch[4];
        const endMs = (+timeMatch[5]*3600 + +timeMatch[6]*60 + +timeMatch[7])*1000 + +timeMatch[8];
        const content = lines.slice(timeLineIndex + 1).join(' ');
        items.push({ startMs, endMs, content });
      }
    }
  });
  return items;
}
