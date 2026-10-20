import { useEffect, useState } from "react";
import { Copy, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { copyText } from "./clipboard";
import { buildInvitationUrl } from "./party/joining";

export function InviteLink({ roomCode, pin }: { roomCode: string; pin?: string }) {
  const canIncludePin = typeof pin === "string" && /^[0-9]{6}$/.test(pin);
  const [includePin, setIncludePin] = useState(canIncludePin);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setIncludePin(canIncludePin); setMessage(null); }, [canIncludePin, roomCode]);
  const joinUrl = buildInvitationUrl(window.location.href, roomCode, canIncludePin && includePin ? pin : undefined);
  const shareSupported = typeof navigator.share === "function";

  async function share() {
    try {
      await navigator.share({ title: "Join our Ko Ho? party", text: `Join room ${roomCode}. Enter your name, then tap Join.`, url: joinUrl });
      setMessage("Invitation shared.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setMessage("Sharing cancelled. Your invitation is still available below.");
      else setMessage("This browser could not share the invitation. Use Copy link or the QR code instead.");
    }
  }

  return <section className="invite-link" aria-label="Invite players">
    <div className="invite-title"><h3>Invite players</h3><span className="invite-room-code">{roomCode}</span></div>
    <p>Scan, enter a name, and tap Join. New players can enter only while this room is in the lobby.</p>
    {canIncludePin ? <label className="invite-pin-choice"><input type="checkbox" checked={includePin} onChange={(event) => { setIncludePin(event.target.checked); setMessage(null); }} /><span>Include the PIN for faster joining</span></label> : <p>Ask the host for the PIN after opening this room.</p>}
    {canIncludePin && includePin && <p className="invite-pin-warning">Anyone with this QR or link can join while the lobby is open. Share it privately. Rotating the joining PIN invalidates old invitations without removing admitted players.</p>}
    <div className="invite-link-qr"><QRCodeSVG value={joinUrl} size={208} level="M" marginSize={4} bgColor="#ffffff" fgColor="#172b22" title={`Scan to open Ko Ho room ${roomCode}${canIncludePin && includePin ? " with the joining PIN filled in" : ""}.`} /></div>
    {shareSupported && <button type="button" className="invite-share-button" onClick={() => { void share(); }}><Share2 size={17} aria-hidden="true" />Share invitation</button>}
    <div className="invite-link-copy"><input aria-label="Room invitation link" readOnly value={joinUrl} onFocus={(event) => event.target.select()} /><button type="button" onClick={async () => setMessage(await copyText(joinUrl) ? `Invitation copied${canIncludePin && includePin ? " with the joining PIN" : "; ask the host for the PIN"}.` : "Automatic copy is unavailable. Select the link to copy it manually.")}><Copy size={15} aria-hidden="true" />Copy link</button></div>
    <p className="invite-privacy-note"><QrCode size={14} aria-hidden="true" />The joining PIN is an invitation, not host or admin access. No player token or recovery code is included. The app removes the PIN from the address bar after reading it; screenshots and forwarded links can still reveal it.</p>
    {message && <p className="invite-copy-message" role="status">{message}</p>}
  </section>;
}
