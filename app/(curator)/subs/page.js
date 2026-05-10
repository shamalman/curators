"use client"
import { Suspense } from "react"
import SubsView from "@/components/subs/SubsView"

export default function SubsPage() {
  return (
    <Suspense fallback={null}>
      <SubsView />
    </Suspense>
  )
}
