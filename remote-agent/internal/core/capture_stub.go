//go:build !windows

package core

import (
	"errors"
	"image"
)

var errNoWindows = errors.New("solo disponible en Windows")

func CaptureScreen() (*image.RGBA, error) { return nil, errNoWindows }
func ScreenSize() (int, int, error)       { return 0, 0, errNoWindows }
