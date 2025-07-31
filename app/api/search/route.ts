import { type NextRequest, NextResponse } from "next/server"

interface SearchRequest {
  location: string
  topK: number
  lens: string
}

interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

interface SearchResponse {
  boundingBox: BoundingBox
  topKCells: { lat: number; lng: number }[]
}

export async function POST(request: NextRequest) {
  try {
    const { location, topK, lens }: SearchRequest = await request.json()
    const backendResponse = await fetch("http://localhost:5000/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ location, topK, lens }),
    })

    if (!backendResponse.ok) {
      throw new Error("Backend request failed")
    }

    const data = await backendResponse.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Search API error:", error)
    return NextResponse.json({ error: "Failed to process search request" }, { status: 500 })
  }
}
