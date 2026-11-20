package core

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
)

// Actualización por regiones (solo agente de nube, con visores nuevos).
//
// Paquete binario (big-endian). Un frame JPEG "viejo" empieza con 0xFF 0xD8,
// así que el visor distingue ambos formatos por el primer byte:
//
//	tipo 1 (completo): [1][seq u32][W u16][H u16][JPEG de toda la imagen]
//	tipo 2 (regiones): [2][seq u32][W u16][H u16][n u16] y n veces
//	                   [x u16][y u16][w u16][h u16][len u32][JPEG de esa región]

const (
	TileSize = 64
	PktFull  = 1
	PktDelta = 2
)

// diffTiles compara dos imágenes del mismo tamaño y marca los mosaicos distintos.
func diffTiles(prev, cur *image.RGBA, changed []bool) (cols, rows, n int) {
	b := cur.Bounds()
	w, h := b.Dx(), b.Dy()
	cols = (w + TileSize - 1) / TileSize
	rows = (h + TileSize - 1) / TileSize
	for ty := 0; ty < rows; ty++ {
		y0 := ty * TileSize
		y1 := y0 + TileSize
		if y1 > h {
			y1 = h
		}
		for tx := 0; tx < cols; tx++ {
			x0 := tx * TileSize
			x1 := x0 + TileSize
			if x1 > w {
				x1 = w
			}
			diff := false
			for y := y0; y < y1 && !diff; y++ {
				o := y*cur.Stride + x0*4
				e := y*cur.Stride + x1*4
				if !bytes.Equal(cur.Pix[o:e], prev.Pix[o:e]) {
					diff = true
				}
			}
			changed[ty*cols+tx] = diff
			if diff {
				n++
			}
		}
	}
	return
}

// copyTileRect copia a prev los píxeles de r (ya enviados).
func copyRect(dst, src *image.RGBA, r image.Rectangle) {
	for y := r.Min.Y; y < r.Max.Y; y++ {
		o := y*src.Stride + r.Min.X*4
		e := y*src.Stride + r.Max.X*4
		copy(dst.Pix[o:e], src.Pix[o:e])
	}
}

// runsFromTiles une mosaicos contiguos de una misma fila en rectángulos.
func runsFromTiles(changed []bool, cols, rows, w, h int) []image.Rectangle {
	var out []image.Rectangle
	for ty := 0; ty < rows; ty++ {
		tx := 0
		for tx < cols {
			if !changed[ty*cols+tx] {
				tx++
				continue
			}
			start := tx
			for tx < cols && changed[ty*cols+tx] {
				tx++
			}
			r := image.Rect(start*TileSize, ty*TileSize, tx*TileSize, (ty+1)*TileSize)
			if r.Max.X > w {
				r.Max.X = w
			}
			if r.Max.Y > h {
				r.Max.Y = h
			}
			out = append(out, r)
		}
	}
	return out
}

func putHeader(b *bytes.Buffer, typ byte, seq uint32, w, h int) {
	var hd [9]byte
	hd[0] = typ
	binary.BigEndian.PutUint32(hd[1:5], seq)
	binary.BigEndian.PutUint16(hd[5:7], uint16(w))
	binary.BigEndian.PutUint16(hd[7:9], uint16(h))
	b.Write(hd[:])
}

// encodeFullPacket codifica toda la imagen.
func encodeFullPacket(img *image.RGBA, seq uint32, quality int, jb *bytes.Buffer) ([]byte, error) {
	b := img.Bounds()
	var out bytes.Buffer
	putHeader(&out, PktFull, seq, b.Dx(), b.Dy())
	jb.Reset()
	if err := jpeg.Encode(jb, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	out.Write(jb.Bytes())
	return out.Bytes(), nil
}

// encodeDeltaPacket codifica solo los rectángulos indicados.
func encodeDeltaPacket(img *image.RGBA, rects []image.Rectangle, seq uint32, quality int, jb *bytes.Buffer) ([]byte, error) {
	b := img.Bounds()
	var out bytes.Buffer
	putHeader(&out, PktDelta, seq, b.Dx(), b.Dy())
	var n [2]byte
	binary.BigEndian.PutUint16(n[:], uint16(len(rects)))
	out.Write(n[:])
	for _, r := range rects {
		jb.Reset()
		if err := jpeg.Encode(jb, img.SubImage(r), &jpeg.Options{Quality: quality}); err != nil {
			return nil, err
		}
		var rh [12]byte
		binary.BigEndian.PutUint16(rh[0:2], uint16(r.Min.X))
		binary.BigEndian.PutUint16(rh[2:4], uint16(r.Min.Y))
		binary.BigEndian.PutUint16(rh[4:6], uint16(r.Dx()))
		binary.BigEndian.PutUint16(rh[6:8], uint16(r.Dy()))
		binary.BigEndian.PutUint32(rh[8:12], uint32(jb.Len()))
		out.Write(rh[:])
		out.Write(jb.Bytes())
	}
	return out.Bytes(), nil
}
