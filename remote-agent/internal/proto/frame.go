package proto

import (
	"encoding/binary"
	"errors"
	"io"
)

// Enmarcado del túnel TLS servidor↔visor (sin HTTP ni WebSocket: así un
// cliente no autenticado no tiene ninguna página/cabecera que consultar).
//
//	[1 byte tipo][4 bytes largo big-endian][payload]
const (
	FrameText   byte = 1
	FrameBinary byte = 2

	MaxPreAuthFrame = 1024            // hasta autenticar
	MaxControlFrame = MaxControlBytes // texto ya autenticado
	MaxMediaFrame   = 6 * 1024 * 1024 // un JPEG
)

var errBadSecret = errors.New("secreto inválido")

func WriteFrame(w io.Writer, typ byte, payload []byte) error {
	var hdr [5]byte
	hdr[0] = typ
	binary.BigEndian.PutUint32(hdr[1:], uint32(len(payload)))
	buf := make([]byte, 0, 5+len(payload))
	buf = append(append(buf, hdr[:]...), payload...)
	_, err := w.Write(buf) // un solo Write: no se mezclan frames
	return err
}

// ReadFrame lee un frame; rechaza (sin reservar memoria) los que superan max.
func ReadFrame(r io.Reader, max int) (byte, []byte, error) {
	var hdr [5]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return 0, nil, err
	}
	typ := hdr[0]
	n := binary.BigEndian.Uint32(hdr[1:])
	if typ != FrameText && typ != FrameBinary {
		return 0, nil, errors.New("tipo de frame inválido")
	}
	if int64(n) > int64(max) {
		return 0, nil, errors.New("frame demasiado grande")
	}
	p := make([]byte, n)
	if _, err := io.ReadFull(r, p); err != nil {
		return 0, nil, err
	}
	return typ, p, nil
}
