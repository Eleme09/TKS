//go:build !windows

package core

import "fmt"

func HasConsole() bool { return true }

func FatalBox(title, text string) { fmt.Println(title + ": " + text) }
