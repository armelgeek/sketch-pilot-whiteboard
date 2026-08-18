import { useEffect, useRef } from 'react'

export default function Controls({ time, onTimeChange, isPlaying, onPlayChange, cfg }) {
  const animRef = useRef()

  const totalMs = cfg
    ? Math.max(
        cfg.sceneDurationMs || 0,
        cfg.elements ? Math.max(...cfg.elements.map(e => e.reveal.startMs + e.reveal.durationMs)) : 0,
        1000
      )
    : 0

  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current)
      return
    }

    let lastTime = Date.now()
    const tick = () => {
      const now = Date.now()
      const dt = now - lastTime
      lastTime = now
      onTimeChange(prev => {
        const newTime = prev + dt
        if (newTime >= totalMs) {
          onPlayChange(false)
          return 0
        }
        return newTime
      })
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [isPlaying, totalMs])

  return (
    <div className="controls flex items-center gap-3.5 px-4.5 py-3 bg-[#161920] border-t border-[#262a34] z-10">
      <button
        onClick={() => onPlayChange(!isPlaying)}
        disabled={totalMs === 0}
        className="play w-10.5 h-10.5 text-lg rounded-full justify-center p-0 shrink-0 bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center"
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      <input
        type="range"
        min="0"
        max={totalMs}
        value={time}
        onChange={e => onTimeChange(parseFloat(e.target.value))}
        disabled={totalMs === 0}
        className="flex-1 accent-blue-500 cursor-pointer h-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      />

      <span className="tlabel font-mono text-slate-400 text-xs font-medium min-w-[140px] text-right">
        {(time / 1000).toFixed(2)}s / {(totalMs / 1000).toFixed(2)}s
      </span>
    </div>
  );
}
