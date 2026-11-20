package core

import (
	"bytes"
	"hash/maphash"
	"image"
	"image/jpeg"

	"golang.org/x/image/draw"
)

// Parte portable de la captura: escala, codificación JPEG y detección de
// frames idénticos.

const (
	MaxFrameWidth  = 1600
	DefaultQuality = 60
)

// ScaledSize calcula el tamaño final con ancho máximo maxW (mantiene aspecto).
func ScaledSize(w, h, maxW int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	if w <= maxW {
		return w, h
	}
	nh := h * maxW / w
	if nh < 1 {
		nh = 1
	}
	return maxW, nh
}

// FrameEncoder convierte capturas en JPEG y omite frames idénticos.
type FrameEncoder struct {
	seed     maphash.Seed
	lastHash uint64
	hasLast  bool
	buf      bytes.Buffer
	MaxW     int // 0 → MaxFrameWidth
	scaled   *image.RGBA
}

func NewFrameEncoder() *FrameEncoder { return &FrameEncoder{seed: maphash.MakeSeed()} }

// ForceNext hace que el próximo frame se envíe aunque sea idéntico.
func (f *FrameEncoder) ForceNext() { f.hasLast = false }

// Encode devuelve el JPEG, el tamaño final y si hay que enviarlo.
func (f *FrameEncoder) Encode(src *image.RGBA, quality int) (data []byte, w, h int, send bool, err error) {
	sb := src.Bounds()
	maxW := f.MaxW
	if maxW <= 0 {
		maxW = MaxFrameWidth
	}
	w, h = ScaledSize(sb.Dx(), sb.Dy(), maxW)
	if w == 0 {
		return nil, 0, 0, false, nil
	}
	var img *image.RGBA
	if w == sb.Dx() && h == sb.Dy() {
		img = src
	} else {
		if f.scaled == nil || f.scaled.Bounds().Dx() != w || f.scaled.Bounds().Dy() != h {
			f.scaled = image.NewRGBA(image.Rect(0, 0, w, h))
		}
		img = f.scaled
		draw.ApproxBiLinear.Scale(img, img.Bounds(), src, sb, draw.Src, nil)
	}
	sum := hashPix(f.seed, img)
	if f.hasLast && sum == f.lastHash {
		return nil, w, h, false, nil
	}
	if quality < 20 || quality > 95 {
		quality = DefaultQuality
	}
	f.buf.Reset()
	if err = jpeg.Encode(&f.buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, w, h, false, err
	}
	f.lastHash, f.hasLast = sum, true
	out := make([]byte, f.buf.Len())
	copy(out, f.buf.Bytes())
	return out, w, h, true, nil
}

func hashPix(seed maphash.Seed, img *image.RGBA) uint64 {
	var mh maphash.Hash
	mh.SetSeed(seed)
	b := img.Bounds()
	rowLen := b.Dx() * 4
	for y := 0; y < b.Dy(); y++ {
		off := y * img.Stride
		mh.Write(img.Pix[off : off+rowLen])
	}
	return mh.Sum64()
}
