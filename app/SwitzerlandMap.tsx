// app/SwitzerlandMap.tsx
"use client"

import type React from "react"
import { useState, useEffect, useMemo, useRef } from "react"
import Select from "react-select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  cn,
  lensOptions,
  colormaps,
  SWITZERLAND_BOUNDS,
  metersToDegreesAtLat,
  getCellSizeMetersForZoom,
} from "@/lib/utils"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { MapContainer, TileLayer, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet"

interface GridCell {
  lat: number
  lng: number
  similarity?: number
  lensSimilarity?: Record<string, number>[]
}

interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

interface BackendResponse {
  topKCells: BoundingBox[]
  similarities: number[]
  lensSimilarity: Record<string, number>[]
}

function BoundingBoxSelector({ onSelect }: { onSelect: (bounds: BoundingBox) => void }) {
  const map = useMapEvents({
    contextmenu(e) {
      if (!selecting.current) {
        // First right-click → start
        startPoint.current = e.latlng
        tempRect.current?.remove()
        tempRect.current = L.rectangle([[e.latlng.lat, e.latlng.lng], [e.latlng.lat, e.latlng.lng]], {
          color: "yellow",
          weight: 2,
          fill: false,
        }).addTo(map)
        selecting.current = true
      } else {
        // Second right-click → finish
        if (startPoint.current) {
          const bounds = L.latLngBounds(startPoint.current, e.latlng)
          onSelect({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
          })
        }
        selecting.current = false
      }
    },
    mousemove(e) {
      if (!selecting.current || !startPoint.current) return
      tempRect.current?.setBounds(L.latLngBounds(startPoint.current, e.latlng))
    },
  })

  const selecting = useRef(false)
  const startPoint = useRef<L.LatLng | null>(null)
  const tempRect = useRef<L.Rectangle | null>(null)
  return null
}

function GridCanvasLayer({
  gridCells,
  getColor,
  opacity = 0.9,
}: {
  gridCells: GridCell[]
  getColor: (g: GridCell) => string
  opacity?: number
}) {
  const map = useMap()
  const layerRef = useRef<L.GridLayer | null>(null)

  useEffect(() => {
    if (!map) return

    let pane = map.getPane("gridPane")
    if (!pane) {
        pane = map.createPane("gridPane")
        pane.style.zIndex = "650"           // above tiles and vectors
        pane.style.pointerEvents = "none"   // let clicks pass through
    }

    const GridAny: any = (L.GridLayer as any).extend({
        createTile: function (coords: L.Coords) {
        const tile = L.DomUtil.create("canvas", "leaflet-tile") as HTMLCanvasElement
        const size = this.getTileSize()
        tile.width = size.x
        tile.height = size.y
        const ctx = tile.getContext("2d") as CanvasRenderingContext2D
        const z = coords.z
        const tileBounds = (this as any)._tileCoordsToBounds(coords) as L.LatLngBounds
        const nw = map.project(tileBounds.getNorthWest(), z)
        const origin = nw
        const scaleX = (p: L.Point) => p.x - origin.x
        const scaleY = (p: L.Point) => p.y - origin.y

        for (const cell of gridCells) {
            const cellSizeMeters = getCellSizeMetersForZoom(z)
            const { latDegrees, lngDegrees } = metersToDegreesAtLat(cellSizeMeters, cell.lat)
            const heightScale = 1.15;
            const widthScale = 0.8;

            const cellBounds = L.latLngBounds(
              L.latLng(cell.lat, cell.lng),
              L.latLng(cell.lat + latDegrees * heightScale, cell.lng + lngDegrees * widthScale)
            )
            if (!tileBounds.intersects(cellBounds)) continue

            const tl = map.project(L.latLng(cellBounds.getNorth(), cellBounds.getWest()), z)
            const br = map.project(L.latLng(cellBounds.getSouth(), cellBounds.getEast()), z)
            const x = scaleX(tl)
            const y = scaleY(tl)
            const w = scaleX(br) - scaleX(tl)
            const h = scaleY(br) - scaleY(tl)

            ctx.globalAlpha = opacity
            ctx.fillStyle = getColor(cell)
            ctx.fillRect(x, y, w, h)
            ctx.globalAlpha = 1
            ctx.strokeStyle = "rgba(0,0,0,0.12)"
            ctx.lineWidth = 0.5
            ctx.strokeRect(x + 0.25, y + 0.25, Math.max(0, w - 0.5), Math.max(0, h - 0.5))
        }

        return tile
        },
    })

    const layer = new GridAny({ tileSize: 256, pane: "gridPane" }) as L.GridLayer
    layer.addTo(map)
    layerRef.current = layer

    return () => {
        layer.remove()
        layerRef.current = null
    }
    }, [map, gridCells, getColor, opacity])

  return null
}

export default function SwitzerlandMap() {
  const [outputSize, setOutputSize] = useState("")
  const [topK, setTopK] = useState("")
  const [lens, setLens] = useState<string[]>([])
  const [highlightedCells, setHighlightedCells] = useState<BoundingBox[]>([])
  const [selectedBounds, setSelectedBounds] = useState<BoundingBox | null>(null)
  const [gridData, setGridData] = useState<GridCell[]>([])
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(8)
  const [center, setCenter] = useState({ lat: 46.8182, lng: 8.2275 })
  const [lensLoading, setLensLoading] = useState(false)
  const [topKCellsWithSimilarity, setTopKCellsWithSimilarity] = useState<
    { box: BoundingBox; similarity: number; lensSimilarity: Record<string, number> }[]
  >([])
  const mapRef = useRef<L.Map | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const getCellColor = useMemo(() => {
    return (cell: GridCell) => {
      if (lens.length > 0 && cell.similarity !== undefined) {
        const cm =
          lens.length === 1
            ? lens[0] === "water"
              ? colormaps.cividis
              : lens[0] === "vegetation"
              ? colormaps.summer_r
              : lens[0] === "topography"
              ? colormaps.plasma
              : lens[0] === "roads"
              ? colormaps.seismic
              : colormaps.viridis
            : colormaps.viridis
        return cm(cell.similarity)
      }
      return "rgba(128,128,128,0)"
    }
  }, [lens])

  const handleBoundingBoxSelect = (bounds: BoundingBox) => {
    setSelectedBounds(bounds)
  }

  const handleSearch = async () => {
    if (!topK || !selectedBounds) return
    const bounds = selectedBounds
    setLoading(true);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boundingBox: bounds,
          topK: Number.parseInt(topK),
          outputSize: Number.parseInt(outputSize),
          lens,
        }),
      });
      if (!response.ok) throw new Error("Search request failed");
      const data: BackendResponse = await response.json();
      setHighlightedCells(data.topKCells);
      setTopKCellsWithSimilarity(
        data.topKCells.map((box, i) => ({
          box,
          similarity: data.similarities[i] ?? 0,
          lensSimilarity:
            typeof data.lensSimilarity?.[i] === "object" ? data.lensSimilarity[i] : {},
        }))
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadGridData = async (lensList: string[]) => {
    if (!mapRef.current) return
    setLensLoading(true)
    const b = mapRef.current.getBounds()
    const minLat = b.getSouth()
    const maxLat = b.getNorth()
    const minLon = b.getWest()
    const maxLon = b.getEast()
    try {
      const response = await fetch(
        `/api/gridcell?${lensList.map((l) => `lens=${l.toLowerCase()}`).join("&")}&minLat=${minLat}&maxLat=${maxLat}&minLon=${minLon}&maxLon=${maxLon}`
      )
      if (!response.ok) throw new Error("Failed to load gridcell data")
      const data = await response.json()
      const processed: GridCell[] = data.coordinates.map((coord: any, i: number) => ({
        lat: coord.lat,
        lng: coord.lon,
        similarity: data.similarities?.[i] ?? Math.random(),
      }))
      setGridData(processed)
    } catch (e) {
      console.error(e)
    } finally {
      setLensLoading(false)
    }
  }

  useEffect(() => {
    if (lens.length === 0) {
      setGridData([])
      return
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => loadGridData(lens), 200)
  }, [lens, zoom, center])

  const MapEvents = () => {
    const map = useMap()
    useEffect(() => {
        mapRef.current = map
        map.setMinZoom(8)
        map.setMaxZoom(14)
        const swiss = L.latLngBounds(
            [SWITZERLAND_BOUNDS.south, SWITZERLAND_BOUNDS.west],
            [SWITZERLAND_BOUNDS.north, SWITZERLAND_BOUNDS.east]
        )
        map.setMaxBounds(swiss)
    }, [map])
    useEffect(() => {
        const onMoveEnd = () => {
            const z = map.getZoom()
            const c = map.getCenter()
            const lat = Math.max(SWITZERLAND_BOUNDS.south, Math.min(SWITZERLAND_BOUNDS.north, c.lat))
            const lng = Math.max(SWITZERLAND_BOUNDS.west, Math.min(SWITZERLAND_BOUNDS.east, c.lng))
            if (lat !== c.lat || lng !== c.lng) map.panTo([lat, lng], { animate: false })
            setZoom(z)
            setCenter({ lat, lng })
        }
        map.on("moveend", onMoveEnd)
        map.on("zoomend", onMoveEnd)
        return () => {
            map.off("moveend", onMoveEnd)
            map.off("zoomend", onMoveEnd)
        }
    }, [map])
    return null
  }

  return (
    <div className="h-screen flex flex-col">
      <Card className="p-4 m-2">
        <div className="grid grid-cols-3 gap-6 items-center w-full">
          
          {/* Inputs + Search */}
          <div className="flex items-center gap-4 w-full">
            <Input
              type="number"
              placeholder="Output Size"
              value={outputSize}
              onChange={(e) => setOutputSize(e.target.value)}
              className="flex-1"
            />
            <Input
              type="number"
              placeholder="Top K"
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleSearch}
              disabled={loading || !location || !topK}
              className="flex-shrink-0"
            >
              {loading ? "Searching..." : "Search"}
            </Button>
          </div>

          {/* Lens Selector */}
          <div className="w-full">
            <Select
              isMulti
              options={lensOptions}
              placeholder="Select lens"
              value={lensOptions.filter((o) => lens.includes(o.value))}
              onChange={(selected) => setLens(selected.map((o) => o.value))}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={{
                menuPortal: (base) => ({ ...base, zIndex: 9999 }),
                menu: (base) => ({ ...base, zIndex: 9999 }),
              }}
            />
          </div>

          {/* Zoom Controls */}
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!mapRef.current) return
                const z = Math.min(14, (mapRef.current.getZoom() ?? zoom) + 1)
                mapRef.current.setZoom(z, { animate: true })
              }}
            >
              +
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!mapRef.current) return
                const z = Math.max(8, (mapRef.current.getZoom() ?? zoom) - 1)
                mapRef.current.setZoom(z, { animate: true })
              }}
            >
              -
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!mapRef.current) return
                setZoom(8)
                setCenter({ lat: 46.8182, lng: 8.2275 })
                mapRef.current.setView([46.8182, 8.2275], 8, { animate: true })
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-center w-screen h-screen relative">
        <div className="w-full h-full border border-gray-300 z-0">
            <MapContainer
                center={[center.lat, center.lng]}
                zoom={zoom}
                style={{ width: "100%", height: "100%" }}
                maxBounds={[
                    [SWITZERLAND_BOUNDS.south, SWITZERLAND_BOUNDS.west],
                    [SWITZERLAND_BOUNDS.north, SWITZERLAND_BOUNDS.east],
                ]}
                maxBoundsViscosity={1.0}
                preferCanvas
            >
            <MapEvents />
            <BoundingBoxSelector onSelect={handleBoundingBoxSelect} />
            <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <GridCanvasLayer gridCells={gridData} getColor={getCellColor} opacity={0.4} />
            {selectedBounds && (
              <Rectangle
                bounds={[
                  [selectedBounds.south, selectedBounds.west],
                  [selectedBounds.north, selectedBounds.east],
                ]}
                pathOptions={{ color: "yellow", weight: 3, fill: false }}
              />
            )}
            {topKCellsWithSimilarity.map((item, i) => (
              <Rectangle
                key={i}
                bounds={[
                  [item.box.south, item.box.west],
                  [item.box.north, item.box.east],
                ]}
                pathOptions={{ color: "red", weight: 2, fill: false }}
              >
                <Tooltip direction="top" sticky>
                  <div className="text-xs">
                    <div>Similarity: {item.similarity.toFixed(3)}</div>
                    {lens.map((l) => (
                      <div key={l}>
                        {l}: {item.lensSimilarity?.[l.toLowerCase()]?.toFixed(3) ?? "—"}
                      </div>
                    ))}
                  </div>
                </Tooltip>
              </Rectangle>
            ))}
          </MapContainer>
        </div>
        {lensLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-20">
            <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-blue-500" />
          </div>
        )}
      </div>

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
            <span>
              Grid ({getCellSizeMetersForZoom(zoom) / 1000} km x {getCellSizeMetersForZoom(zoom) / 1000}km)
            </span>
          </div>
          {lens.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap">
              {lens.length > 1 ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-gradient-to-r from-green-500 to-purple-500" />
                  <span>
                    Combined ({lens.map((l) => lensOptions.find((opt) => opt.value === l)?.label ?? l).join(", ")})
                  </span>
                </div>
              ) : (
                lens.map((l) => {
                  const label = lensOptions.find((opt) => opt.value === l)?.label ?? l
                  const gradientClass =
                    l === "water"
                      ? "from-blue-900 to-yellow-200"
                      : l === "vegetation"
                      ? "from-yellow-300 to-green-700"
                      : l === "topography"
                      ? "from-purple-700 to-yellow-500"
                      : l === "roads"
                      ? "from-blue-400 to-red-600"
                      : "from-gray-300 to-gray-500"
                  return (
                    <div key={l} className="flex items-center gap-2">
                      <div className={`w-4 h-4 bg-gradient-to-r ${gradientClass}`} />
                      <span>{label}</span>
                    </div>
                  )
                })
              )}
            </div>
          )}
          <div className="flex items-center text-xs text-gray-500">Zoom: {zoom} | Drag to pan, scroll to zoom</div>
          <div className="flex items-center text-xs text-gray-500">
            Note: Data for grid cells outside of Switzerland are not accurate
          </div>
        </div>
      </Card>
    </div>
  )
}