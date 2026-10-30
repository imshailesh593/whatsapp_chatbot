// The product logo (the robot in the chat bubble). The file lives in web/public and is served from the console's own address.
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <img src="/admin/wappo-icon.png" alt="Wappo" width={size} height={size} className={`rounded-xl shrink-0 ${className}`} />;
}
