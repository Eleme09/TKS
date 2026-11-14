//go:build windows

package core

import (
	"errors"
	"image"

	"github.com/kbinani/screenshot"
	"golang.org/x/sys/windows"
)

func init() {
	// Coordenadas físicas (sin escalado DPI) para que captura e input coincidan.
	windows.NewLazySystemDLL("user32.dll").NewProc("SetProcessDPIAware").Call()
}

// CaptureScreen captura el monitor principal (solo lectura de pantalla; nada se graba a disco).
func CaptureScreen() (*image.RGBA, error) {
	if screenshot.NumActiveDisplays() < 1 {
		return nil, errors.New("sin pantallas activas")
	}
	return screenshot.CaptureDisplay(0)
}

func ScreenSize() (int, int, error) {
	if screenshot.NumActiveDisplays() < 1 {
		return 0, 0, errors.New("sin pantallas activas")
	}
	b := screenshot.GetDisplayBounds(0)
	return b.Dx(), b.Dy(), nil
}

func primaryBounds() (image.Rectangle, error) {
	if screenshot.NumActiveDisplays() < 1 {
		return image.Rectangle{}, errors.New("sin pantallas activas")
	}
	return screenshot.GetDisplayBounds(0), nil
}
