// app/page.tsx
import dynamic from "next/dynamic"

const SwitzerlandMap = dynamic(() => import("./SwitzerlandMap"), { ssr: false })

export default function Page() {
  return <SwitzerlandMap />
}
