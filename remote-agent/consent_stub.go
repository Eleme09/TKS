//go:build !windows

package main

import "context"

// En plataformas que no son Windows nunca se acepta nada.
func askConsent(ctx context.Context, viewer string) bool { return false }
