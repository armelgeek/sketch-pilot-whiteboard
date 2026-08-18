export default function Toast({ msg, type }) {
  if (!msg) return null

  const icon = type === 'err' ? '✕' : '✓'

  return (
    <div className={`toast ${type === 'err' ? 'err' : 'info'}`}>
      <span style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {icon}
      </span>
      {msg}
    </div>
  )
}
