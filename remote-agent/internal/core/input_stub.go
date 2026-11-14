//go:build !windows

package core

func injectMouse(a string, x, y float64, b int, d float64) {}
func injectKey(vk uint16, ext bool, down bool)             {}
func releaseMouseButtons()                                 {}
