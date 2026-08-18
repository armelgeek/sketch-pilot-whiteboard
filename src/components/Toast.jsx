export default function Toast({ msg, type }) {
  if (!msg) return null

  const bgColor = type === 'err' ? 'bg-red-500' : type === 'info' ? 'bg-blue-500' : 'bg-emerald-500'

  return (
    <div
      className={`toast fixed bottom-[70px] left-1/2 -translate-x-1/2 text-white px-5 py-2.5 rounded-lg text-[13.5px] font-semibold opacity-100 transition-all duration-200 z-[1000] shadow-[0_10px_25px_rgba(0,0,0,0.5)] ${bgColor}`}
    >
      {msg}
    </div>
  );
}
