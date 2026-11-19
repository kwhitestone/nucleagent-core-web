import { useLayoutEffect, useRef, useState } from 'react';

export function ThinkingFold({ text, active, label, running, latest }: {
  text: string; active: boolean; label: string; running: string; latest: string;
}) {
  const [open, setOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const region = useRef<HTMLPreElement>(null);
  const lastTop = useRef(0);
  const bottom = () => {
    if (region.current) lastTop.current = region.current.scrollTop = region.current.scrollHeight;
  };
  useLayoutEffect(() => { if (open && following) bottom(); }, [text, open, following]);
  return <details className="mc-process mc-reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="mc-process-head">{label}{active && <span role="status"> · {running}</span>}</summary>
    <pre ref={region} className="mc-step-detail" tabIndex={0} onScroll={(event) => {
      const view = event.currentTarget;
      const near = view.scrollHeight - view.clientHeight - view.scrollTop <= 8;
      if (view.scrollTop < lastTop.current || near) setFollowing(near);
      lastTop.current = view.scrollTop;
    }}>{text}</pre>
    {!following && <button type="button" className="mc-earlier" onClick={() => { setFollowing(true); bottom(); }}>{latest}</button>}
  </details>;
}
