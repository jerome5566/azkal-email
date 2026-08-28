import { PageHeader, Card, Pill } from "@/components/ui";

export default function ServerPage() {
  const configured = Boolean(process.env.SMTP_HOST);

  return (
    <>
      <PageHeader title="Sending Server" sub="OVH Postfix delivery infrastructure" />

      <div className="max-w-3xl space-y-6">
        <Card title="Connection">
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${configured ? "bg-good" : "bg-ink-faint"}`} />
            <span className="text-[14px] text-ink-soft flex-1">
              {configured
                ? `Configured: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}`
                : "No SMTP host set. The mail server has not been provisioned yet."}
            </span>
            <Pill tone={configured ? "good" : "neutral"}>
              {configured ? "Configured" : "Not set up"}
            </Pill>
          </div>
        </Card>

        <Card title="Checklist before the first send">
          <ol className="space-y-2.5 text-[14px] text-ink-soft list-decimal list-inside">
            <li>OVH VPS provisioned, 4GB</li>
            <li>DNS A record for mail.azkalmedia.agency</li>
            <li>Reverse DNS on the OVH IP matching the Postfix HELO name</li>
            <li>SPF record listing the OVH IP</li>
            <li>DKIM key published, selector azkal</li>
            <li>DMARC record at p=none with a reporting address</li>
            <li>Postfix firewall allowing port 587 only from the Cloudways IP</li>
            <li>Bounce and unsubscribe mailboxes created in Dovecot</li>
            <li>Google Postmaster Tools verified for azkalmedia.agency</li>
            <li>Warmup ramp started on a seed list</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
