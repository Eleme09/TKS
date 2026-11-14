//go:build !windows

package main

func initConsole()           { vtOK = true }
func setConsoleTitle(string) {}

// En no-Windows no hay tecla global ni manejador de cierre (solo Ctrl+C vía señal en main).
func installLocalCut(func())     {}
func installCloseHandler(func()) {}
