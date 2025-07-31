"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import {
  cn,
  colormaps,
  SWITZERLAND_BOUNDS,
  metersToDegreesAtLat,
  deg2num,
  num2deg,
  getCellSizeMetersForZoom,
  latLngToPixel,
} from "@/lib/utils"

interface GridCell {
  lat: number
  lng: number
  similarity?: number
}

interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

interface BackendResponse {
  boundingBox: BoundingBox
  topKCells: BoundingBox[]
}

export default function SwitzerlandMap() {
  const [location, setLocation] = useState("")
  const [topK, setTopK] = useState("")
  const [lens, setLens] = useState("No lens selected")
  const [highlightedCells, setHighlightedCells] = useState<BoundingBox[]>([])
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null)
  const [gridData, setGridData] = useState<GridCell[]>([])
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(8)
  const [center, setCenter] = useState({ lat: 46.8182, lng: 8.2275 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, lat: 0, lng: 0 })
  const [loadedTiles, setLoadedTiles] = useState<Map<string, HTMLImageElement>>(new Map())
  const [lensLoading, setLensLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Generate grid cells
  const generateGrid = () => {
    const cells = []
    // const cellSizeMeters = 1000
    const cellSizeMeters = getCellSizeMetersForZoom(zoom)

    // Calculate step size for each latitude to maintain square cells
    for (let lat = SWITZERLAND_BOUNDS.south; lat < SWITZERLAND_BOUNDS.north; ) {
      const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, lat)

      for (let lng = SWITZERLAND_BOUNDS.west; lng < SWITZERLAND_BOUNDS.east; lng += lngDegrees) {
        cells.push({ lat, lng })
      }

      lat += latDegrees
    }
    return cells
  }

  const gridCells = generateGrid()

  const getCellColor = (cell: GridCell) => {
    // Apply lens coloring
    if (lens !== "No lens selected" && cell.similarity !== undefined) {
      const colormap =
        lens === "Water"
          ? colormaps.cividis_r
          : lens === "Vegetation"
            ? colormaps.summer_r
            : lens === "Topography"
              ? colormaps.plasma
              : lens === "Road Network"
                ? colormaps.seismic
                : null

      if (colormap) {
        return colormap(cell.similarity)
      }
    }

    return "rgba(128, 128, 128, 0.1)"
  }

  // Load map tiles
  const loadTile = (x: number, y: number, z: number): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const tileKey = `${z}/${x}/${y}`

      if (loadedTiles.has(tileKey)) {
        resolve(loadedTiles.get(tileKey)!)
        return
      }

      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        setLoadedTiles((prev) => new Map(prev).set(tileKey, img))
        resolve(img)
      }
      img.onerror = reject
      img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
    })
  }

  // Draw the map
  const drawMap = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate visible tiles
    const mapWidth = canvas.width
    const mapHeight = canvas.height

    // Calculate bounds for current view
    const viewBounds = {
      north: center.lat + (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      south: center.lat - (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      east: center.lng + (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
      west: center.lng - (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
    }

    // Get tile coordinates for current view
    const topLeft = deg2num(viewBounds.north, viewBounds.west, zoom)
    const bottomRight = deg2num(viewBounds.south, viewBounds.east, zoom)

    // Draw map tiles
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        try {
          const img = await loadTile(x, y, zoom)

          // Calculate tile position on canvas
          const tileTopLeft = num2deg(x, y, zoom)
          const tileBottomRight = num2deg(x + 1, y + 1, zoom)

          const pixelTopLeft = latLngToPixel(tileTopLeft.lat, tileTopLeft.lng, viewBounds, mapWidth, mapHeight)
          const pixelBottomRight = latLngToPixel(
            tileBottomRight.lat,
            tileBottomRight.lng,
            viewBounds,
            mapWidth,
            mapHeight,
          )

          const tileWidth = pixelBottomRight.x - pixelTopLeft.x
          const tileHeight = pixelBottomRight.y - pixelTopLeft.y

          ctx.drawImage(img, pixelTopLeft.x, pixelTopLeft.y, tileWidth, tileHeight)
        } catch (error) {
          // Skip failed tiles
          console.warn(`Failed to load tile ${x}/${y}/${zoom}`)
        }
      }
    }

    // Draw grid cells
    // const cellSizeMeters = 1000
    const cellSizeMeters = getCellSizeMetersForZoom(zoom)
    gridCells.forEach((cell) => {
      // Only draw cells that are visible
      if (
        cell.lat < viewBounds.south ||
        cell.lat > viewBounds.north ||
        cell.lng < viewBounds.west ||
        cell.lng > viewBounds.east
      ) {
        return
      }

      const gridCell =
        gridData.find((gCell) => Math.abs(gCell.lat - cell.lat) < 0.01 && Math.abs(gCell.lng - cell.lng) < 0.01) || cell

      // Calculate square cell dimensions at this latitude
      const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, cell.lat)

      const topLeft = latLngToPixel(cell.lat + latDegrees, cell.lng, viewBounds, mapWidth, mapHeight)
      const bottomRight = latLngToPixel(cell.lat, cell.lng + lngDegrees, viewBounds, mapWidth, mapHeight)

      const width = bottomRight.x - topLeft.x
      const height = bottomRight.y - topLeft.y

      const cellColor = getCellColor(gridCell)

      // Only draw grid if lens is selected or cell is highlighted
      if (
        lens !== "No lens selected" ||
        highlightedCells.some(
          (box) =>
            cell.lat >= box.south &&
            cell.lat <= box.north &&
            cell.lng >= box.west &&
            cell.lng <= box.east
        )
      ) {
        ctx.fillStyle = cellColor
        ctx.fillRect(topLeft.x, topLeft.y, width, height)
      }

      // Draw grid lines (very subtle)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.1)"
      ctx.lineWidth = 0.5
      ctx.strokeRect(topLeft.x, topLeft.y, width, height)
    })

    // Draw bounding box
    if (boundingBox) {
      const topLeft = latLngToPixel(boundingBox.north, boundingBox.west, viewBounds, mapWidth, mapHeight)
      const bottomRight = latLngToPixel(boundingBox.south, boundingBox.east, viewBounds, mapWidth, mapHeight)
      ctx.strokeStyle = "yellow"
      ctx.lineWidth = 3
      ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
    }
    if (highlightedCells.length > 0) {
      const cellSizeMeters = getCellSizeMetersForZoom(zoom)

      highlightedCells.forEach((box) => {
        const topLeft = latLngToPixel(box.north, box.west, viewBounds, mapWidth, mapHeight)
        const bottomRight = latLngToPixel(box.south, box.east, viewBounds, mapWidth, mapHeight)

        ctx.strokeStyle = "red"
        ctx.lineWidth = 2
        ctx.strokeRect(
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y
        )
      })
    }
  }

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      lat: center.lat,
      lng: center.lng,
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y

      const canvas = canvasRef.current
      if (!canvas) return

      const sensitivity = 0.01 * Math.pow(2, 8 - zoom)
      const newLat = dragStart.lat + deltaY * sensitivity
      const newLng = dragStart.lng - deltaX * sensitivity

      // Viewport "half size" in degrees (assuming Switzerland bounds define zoom level 8 extent)
      const latSpan = (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / Math.pow(2, zoom - 8)
      const lngSpan = (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / Math.pow(2, zoom - 8)

      const latMin = SWITZERLAND_BOUNDS.south + latSpan / 2
      const latMax = SWITZERLAND_BOUNDS.north - latSpan / 2
      const lngMin = SWITZERLAND_BOUNDS.west + lngSpan / 2
      const lngMax = SWITZERLAND_BOUNDS.east - lngSpan / 2

      setCenter({
        lat: Math.max(latMin, Math.min(latMax, newLat)),
        lng: Math.max(lngMin, Math.min(lngMax, newLng)),
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1

    setZoom((prevZoom) => {
      const newZoom = Math.max(8, Math.min(14, prevZoom + delta))

      // Recalculate viewport span at new zoom level
      const latSpan = (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / Math.pow(2, newZoom - 8)
      const lngSpan = (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / Math.pow(2, newZoom - 8)

      const latMin = SWITZERLAND_BOUNDS.south + latSpan / 2
      const latMax = SWITZERLAND_BOUNDS.north - latSpan / 2
      const lngMin = SWITZERLAND_BOUNDS.west + lngSpan / 2
      const lngMax = SWITZERLAND_BOUNDS.east - lngSpan / 2

      // Clamp current center to the new bounds
      setCenter((prevCenter) => ({
        lat: Math.max(latMin, Math.min(latMax, prevCenter.lat)),
        lng: Math.max(lngMin, Math.min(lngMax, prevCenter.lng)),
      }))

      return newZoom
    })
  }

  const handleSearch = async () => {
    if (!location || !topK) return

    setLoading(true)

    try {
      // Call your actual backend API
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          location: location,
          topK: Number.parseInt(topK),
          lens: lens
        }),
      })

      if (!response.ok) {
        throw new Error("Search request failed")
      }

      const data: BackendResponse = await response.json()

      setHighlightedCells(data.topKCells)
      setBoundingBox(data.boundingBox)

      if (data.boundingBox) {
        let centerLat = (data.boundingBox.north + data.boundingBox.south) / 2
        let centerLng = (data.boundingBox.east + data.boundingBox.west) / 2
        const targetZoom = 10

        // Compute viewport extent at target zoom
        const latSpan = (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / Math.pow(2, targetZoom - 8)
        const lngSpan = (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / Math.pow(2, targetZoom - 8)

        const latMin = SWITZERLAND_BOUNDS.south + latSpan / 2
        const latMax = SWITZERLAND_BOUNDS.north - latSpan / 2
        const lngMin = SWITZERLAND_BOUNDS.west + lngSpan / 2
        const lngMax = SWITZERLAND_BOUNDS.east - lngSpan / 2

        // Clamp center to valid range
        centerLat = Math.max(latMin, Math.min(latMax, centerLat))
        centerLng = Math.max(lngMin, Math.min(lngMax, centerLng))

        setCenter({ lat: centerLat, lng: centerLng })
        setZoom(targetZoom)
      }
    } catch (error) {
      console.error("Search failed:", error)
      // Fallback to mock data for demo
      const mockResponse: BackendResponse = {
        boundingBox: {
          north: 47.4,
          south: 47.3,
          east: 8.6,
          west: 8.5,
        },
        topKCells: Array.from({ length: Number.parseInt(topK) }, (_, i) => ({
          lat: 47.35 + i * 0.01,
          lng: 8.55 + i * 0.01,
        })),
      }

      setHighlightedCells(mockResponse.topKCells)
      setBoundingBox(mockResponse.boundingBox)
    } finally {
      setLoading(false)
    }
  }

  // Load grid data for lens coloring
  const loadGridData = async (lensType: string) => {
    setLensLoading(true)
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const viewBounds = {
      north: center.lat + (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      south: center.lat - (SWITZERLAND_BOUNDS.north - SWITZERLAND_BOUNDS.south) / (2 * Math.pow(2, zoom - 8)),
      east: center.lng + (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
      west: center.lng - (SWITZERLAND_BOUNDS.east - SWITZERLAND_BOUNDS.west) / (2 * Math.pow(2, zoom - 8)),
    }

    try {
      const response = await fetch(
        `/api/gridcell?lens=${lensType.toLowerCase()}&minLat=${viewBounds.south}&maxLat=${viewBounds.north}&minLon=${viewBounds.west}&maxLon=${viewBounds.east}`
      )

      if (!response.ok) throw new Error("Failed to load gridcell data")

      const data = await response.json()

      const processedGridData: GridCell[] = data.coordinates.map((coord: any, index: number) => ({
        lat: coord.lat,
        lng: coord.lon,
        similarity: data.similarities?.[index] ?? Math.random(),
      }))

      setGridData(processedGridData)
    } catch (error) {
      console.error("Failed to load gridcell data:", error)
    } finally {
      setLensLoading(false)
    }
  }

  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (lens === "No lens selected") {
      setGridData([])
      return
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => loadGridData(lens), 200)
  }, [lens, center, zoom])

  // Redraw when data changes
  useEffect(() => {
    drawMap()
  }, [center, zoom, gridData, highlightedCells, boundingBox, lens])

  // Handle resize
  useEffect(() => {
    const handleResize = () => drawMap()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <div className="h-screen flex flex-col">
      {/* Top control bar */}
      <Card className="p-4 m-2">
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="Enter location name..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="w-24">
            <Input type="number" placeholder="Top K" value={topK} onChange={(e) => setTopK(e.target.value)} />
          </div>

          <Button onClick={handleSearch} disabled={loading || !location || !topK}>
            {loading ? "Searching..." : "Search"}
          </Button>

          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="No lens selected">No lens selected</SelectItem>
              <SelectItem value="Water">Water</SelectItem>
              <SelectItem value="Vegetation">Vegetation</SelectItem>
              <SelectItem value="Topography">Topography</SelectItem>
              <SelectItem value="Road Network">Road Network</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((prev) => Math.min(12, prev + 1))}>
              +
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoom((prev) => Math.max(6, prev - 1))}>
              -
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setZoom(8)
                setCenter({ lat: 46.8182, lng: 8.2275 })
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {/* Map container */}
      <div className="flex items-center justify-center w-screen h-screen relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="w-3/4 h-full border border-gray-300 cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        />
        {lensLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
            <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-blue-500" />
          </div>
        )}
      </div>

      {/* Legend */}
      <Card className="p-4 m-2">
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-red-500"></div>
            <span>Top K Cells</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-yellow-500"></div>
            <span>Bounding Box</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-300 opacity-50"></div>
            <span>Grid ({getCellSizeMetersForZoom(zoom) / 1000} km x {getCellSizeMetersForZoom(zoom) / 1000}km)</span>
          </div>
          {lens !== "No lens selected" && (
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 bg-gradient-to-r ${
                  lens === "Water"
                    ? "from-blue-900 to-yellow-200"
                    : lens === "Vegetation"
                    ? "from-yellow-300 to-green-700"
                    : lens === "Topography"
                    ? "from-purple-700 to-yellow-500"
                    : lens === "Road Network"
                    ? "from-blue-400 to-red-600"
                    : "from-gray-300 to-gray-500"
                }`}
              />
              <span>{lens} Similarity</span>
            </div>
          )}
          <div className="flex items-center text-xs text-gray-500">Zoom: {zoom} | Drag to pan, scroll to zoom</div>
          <div className="flex items-center text-xs text-gray-500">Note: Data for grid cells outside of Switzerland are not accurate</div>
        </div>
      </Card>
    </div>
  )
}
