//go:build !windows

package main

import (
	"errors"
	"image"
)

var errNoWindows = errors.New("solo disponible en Windows")

func captureScreen() (*image.RGBA, error) { return nil, errNoWindows }
func screenSize() (int, int, error)       { return 0, 0, errNoWindows }
