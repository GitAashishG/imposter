import { useState } from "react";
import { Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { copyText } from "./clipboard";

export function InviteLink() {
  const [message, setMessage] = useState<string | null>(null);
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "party");
  const joinUrl = url.href;

  return (
    <section className="invite-link" aria-label="Invite your people">
      <h3>Get everyone to the circle.</h3>
      <p>Open this link on each phone. Share your six-digit PIN separately.</p>
      <div className="invite-link-copy">
        <input
          aria-label="Own Phones invitation link"
          readOnly
          value={joinUrl}
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
          onClick={async () =>
            setMessage(
              (await copyText(joinUrl))
                ? "Join link copied. The PIN is not included."
                : "Automatic copy is unavailable. Select the link to copy it manually.",
            )
          }
        >
          <Copy size={15} aria-hidden="true" />
          Copy link
        </button>
      </div>
      <details className="invite-link-details">
        <summary>
          <QrCode size={17} aria-hidden="true" />
          Show join QR code
        </summary>
        <div className="invite-link-qr">
          <QRCodeSVG
            value={joinUrl}
            size={184}
            level="M"
            marginSize={4}
            bgColor="#ffffff"
            fgColor="#172b22"
            title="Scan to open Ko Ho Own Phones. Ask your host for the PIN."
          />
        </div>
        <p>
          This code only opens Own Phones. It contains no PIN, player token, or
          host recovery code.
        </p>
      </details>
      {message && (
        <p className="invite-copy-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
