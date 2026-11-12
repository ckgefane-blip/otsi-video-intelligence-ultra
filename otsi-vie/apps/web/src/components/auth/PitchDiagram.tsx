/** The SOT's pitch diagram (Setup.dc.html / Invite.dc.html), decorative: the pitch outline with three tracked players. */
export function PitchDiagram() {
  return (
    <svg viewBox="0 0 680 440" aria-hidden="true" className="block h-auto w-full max-w-[560px] opacity-70">
      <g fill="none" stroke="#1F2A25" strokeWidth="1.5"><rect x="10" y="10" width="660" height="420" rx="4"></rect><path d="M340 10v420"></path><circle cx="340" cy="220" r="62"></circle><rect x="10" y="118" width="108" height="204"></rect><rect x="562" y="118" width="108" height="204"></rect><rect x="10" y="168" width="38" height="104"></rect><rect x="632" y="168" width="38" height="104"></rect></g>
      <g fill="none" stroke="#2BD4B0" strokeWidth="1.5" opacity=".55"><rect x="252" y="150" width="26" height="54" rx="2"></rect><rect x="392" y="236" width="26" height="54" rx="2"></rect><rect x="470" y="128" width="24" height="50" rx="2" strokeDasharray="4 3"></rect></g>
    </svg>
  );
}
