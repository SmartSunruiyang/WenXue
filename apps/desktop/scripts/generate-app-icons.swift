#!/usr/bin/env swift

import AppKit
import Foundation

private struct IconStyle {
	let visibleFraction: CGFloat
	let shadow: Bool
}

private let packageRoot = URL(fileURLWithPath: #filePath)
	.deletingLastPathComponent()
	.deletingLastPathComponent()
	.standardizedFileURL
private let resourcesDirectory = packageRoot.appendingPathComponent("resources", isDirectory: true)
private let sourceURL = resourcesDirectory.appendingPathComponent("icon.png")
private let macMasterURL = resourcesDirectory.appendingPathComponent("app-icon-macos-1024.png")
private let macIcnsURL = resourcesDirectory.appendingPathComponent("app-icon-macos.icns")
private let windowsIcoURL = resourcesDirectory.appendingPathComponent("app-icon-windows.ico")
private let brandAssetsDirectory = packageRoot
	.deletingLastPathComponent()
	.deletingLastPathComponent()
	.appendingPathComponent(".project.agents/assets", isDirectory: true)

private let macStyle = IconStyle(visibleFraction: 824 / 1024, shadow: true)

private func signedPower(_ value: CGFloat, exponent: CGFloat) -> CGFloat {
	let magnitude = CGFloat(pow(Double(abs(value)), Double(exponent)))
	return value < 0 ? -magnitude : magnitude
}

private func superellipse(in rect: CGRect, exponent: CGFloat = 5) -> CGPath {
	let path = CGMutablePath()
	let center = CGPoint(x: rect.midX, y: rect.midY)
	let radiusX = rect.width / 2
	let radiusY = rect.height / 2
	let power = 2 / exponent

	for index in 0...512 {
		let angle = CGFloat(index) / 512 * 2 * .pi
		let point = CGPoint(
			x: center.x + radiusX * signedPower(cos(angle), exponent: power),
			y: center.y + radiusY * signedPower(sin(angle), exponent: power),
		)
		if index == 0 {
			path.move(to: point)
		} else {
			path.addLine(to: point)
		}
	}
	path.closeSubpath()
	return path
}

private func drawShadow(
	in context: CGContext,
	path: CGPath,
	offset: CGSize,
	blur: CGFloat,
	alpha: CGFloat
) {
	context.saveGState()
	context.setShadow(
		offset: offset,
		blur: blur,
		color: NSColor.black.withAlphaComponent(alpha).cgColor,
	)
	context.addPath(path)
	context.setFillColor(NSColor.white.cgColor)
	context.fillPath()
	context.restoreGState()
}

private func renderIcon(source: CGImage, size: Int, style: IconStyle) throws -> Data {
	guard
		let context = CGContext(
			data: nil,
			width: size,
			height: size,
			bitsPerComponent: 8,
			bytesPerRow: 0,
			space: CGColorSpace(name: CGColorSpace.sRGB)!,
			bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue,
		)
	else {
		throw NSError(domain: "WenXueIconGenerator", code: 1)
	}

	context.setAllowsAntialiasing(true)
	context.setShouldAntialias(true)
	context.interpolationQuality = .high
	context.clear(CGRect(x: 0, y: 0, width: size, height: size))

	let visibleSize = CGFloat(size) * style.visibleFraction
	let visibleRect = CGRect(
		x: (CGFloat(size) - visibleSize) / 2,
		y: (CGFloat(size) - visibleSize) / 2,
		width: visibleSize,
		height: visibleSize,
	)
	let mask = superellipse(in: visibleRect)

	if style.shadow {
		let scale = CGFloat(size) / 1024
		drawShadow(
			in: context,
			path: mask,
			offset: CGSize(width: 0, height: -10 * scale),
			blur: 24 * scale,
			alpha: 0.2,
		)
		drawShadow(
			in: context,
			path: mask,
			offset: CGSize(width: 0, height: -3 * scale),
			blur: 8 * scale,
			alpha: 0.16,
		)
	}

	context.saveGState()
	context.addPath(mask)
	context.clip()
	context.draw(source, in: visibleRect)
	context.restoreGState()

	guard let image = context.makeImage() else {
		throw NSError(domain: "WenXueIconGenerator", code: 2)
	}
	let representation = NSBitmapImageRep(cgImage: image)
	guard let data = representation.representation(using: .png, properties: [:]) else {
		throw NSError(domain: "WenXueIconGenerator", code: 3)
	}
	return data
}

private func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
	var littleEndian = value.littleEndian
	withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
}

private func createWindowsIco(frames: [(size: Int, data: Data)]) -> Data {
	var result = Data()
	appendLittleEndian(UInt16(0), to: &result)
	appendLittleEndian(UInt16(1), to: &result)
	appendLittleEndian(UInt16(frames.count), to: &result)

	var offset = UInt32(6 + frames.count * 16)
	for frame in frames {
		result.append(frame.size == 256 ? 0 : UInt8(frame.size))
		result.append(frame.size == 256 ? 0 : UInt8(frame.size))
		result.append(0)
		result.append(0)
		appendLittleEndian(UInt16(1), to: &result)
		appendLittleEndian(UInt16(32), to: &result)
		appendLittleEndian(UInt32(frame.data.count), to: &result)
		appendLittleEndian(offset, to: &result)
		offset += UInt32(frame.data.count)
	}

	for frame in frames {
		result.append(frame.data)
	}
	return result
}

private func generateMacIcons(source: CGImage) throws {
	try renderIcon(source: source, size: 1024, style: macStyle).write(to: macMasterURL, options: .atomic)

	let iconsetURL = FileManager.default.temporaryDirectory
		.appendingPathComponent("wenxue-\(UUID().uuidString).iconset", isDirectory: true)
	try FileManager.default.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
	defer { try? FileManager.default.removeItem(at: iconsetURL) }

	let representations: [(name: String, size: Int)] = [
		("icon_16x16.png", 16),
		("icon_16x16@2x.png", 32),
		("icon_32x32.png", 32),
		("icon_32x32@2x.png", 64),
		("icon_128x128.png", 128),
		("icon_128x128@2x.png", 256),
		("icon_256x256.png", 256),
		("icon_256x256@2x.png", 512),
		("icon_512x512.png", 512),
		("icon_512x512@2x.png", 1024),
	]
	for representation in representations {
		let data = try renderIcon(source: source, size: representation.size, style: macStyle)
		try data.write(to: iconsetURL.appendingPathComponent(representation.name), options: .atomic)
	}

	let process = Process()
	process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
	process.arguments = ["--convert", "icns", "--output", macIcnsURL.path, iconsetURL.path]
	try process.run()
	process.waitUntilExit()
	guard process.terminationStatus == 0 else {
		throw NSError(domain: "WenXueIconGenerator", code: Int(process.terminationStatus))
	}
}

private func loadImage(at url: URL) throws -> CGImage {
	guard
		let image = NSImage(contentsOf: url),
		let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
	else {
		throw NSError(
			domain: "WenXueIconGenerator", code: 4,
			userInfo: [NSLocalizedDescriptionKey: "Unable to read \(url.path)"],
		)
	}
	return cgImage
}

private func makeWindowsContext(width: Int, height: Int) throws -> CGContext {
	guard let context = CGContext(
		data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
		space: CGColorSpace(name: CGColorSpace.sRGB)!,
		bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
	) else {
		throw NSError(domain: "WenXueIconGenerator", code: 5)
	}
	context.setAllowsAntialiasing(true)
	context.setShouldAntialias(true)
	context.interpolationQuality = .high
	context.clear(CGRect(x: 0, y: 0, width: width, height: height))
	return context
}

private func drawWindowsIcon(glyph: CGImage, in context: CGContext, size: Int) {
	let length = CGFloat(size)
	let inset = max(1, (length / 24).rounded())
	let borderWidth = max(1, length / 96)
	let plateRect = CGRect(x: inset, y: inset, width: length - 2 * inset, height: length - 2 * inset)
	let radius = max(1, length / 24)
	let plate = CGPath(
		roundedRect: plateRect.insetBy(dx: borderWidth / 2, dy: borderWidth / 2),
		cornerWidth: radius, cornerHeight: radius, transform: nil,
	)
	context.addPath(plate)
	context.setFillColor(NSColor.white.cgColor)
	context.setStrokeColor(NSColor(srgbRed: 0.84, green: 0.84, blue: 0.84, alpha: 1).cgColor)
	context.setLineWidth(borderWidth)
	context.drawPath(using: .fillStroke)

	let glyphHeight = (length * 0.72).rounded()
	let glyphWidth = (glyphHeight * CGFloat(glyph.width) / CGFloat(glyph.height)).rounded()
	let glyphRect = CGRect(
		x: ((length - glyphWidth) / 2).rounded(), y: ((length - glyphHeight) / 2).rounded(),
		width: glyphWidth, height: glyphHeight,
	)
	context.draw(glyph, in: glyphRect)
}

private func renderWindowsIcon(glyph: CGImage, size: Int) throws -> Data {
	let context = try makeWindowsContext(width: size, height: size)
	drawWindowsIcon(glyph: glyph, in: context, size: size)
	guard
		let image = context.makeImage(),
		let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
	else {
		throw NSError(domain: "WenXueIconGenerator", code: 6)
	}
	return data
}

private func createBitmap24(context: CGContext) throws -> Data {
	guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else {
		throw NSError(domain: "WenXueIconGenerator", code: 7)
	}
	let width = context.width
	let height = context.height
	let rowBytes = (width * 3 + 3) & ~3
	let pixelBytes = rowBytes * height
	var result = Data([0x42, 0x4D])
	appendLittleEndian(UInt32(54 + pixelBytes), to: &result)
	appendLittleEndian(UInt32(0), to: &result)
	appendLittleEndian(UInt32(54), to: &result)
	appendLittleEndian(UInt32(40), to: &result)
	appendLittleEndian(Int32(width), to: &result)
	appendLittleEndian(Int32(height), to: &result)
	appendLittleEndian(UInt16(1), to: &result)
	appendLittleEndian(UInt16(24), to: &result)
	appendLittleEndian(UInt32(0), to: &result)
	appendLittleEndian(UInt32(pixelBytes), to: &result)
	appendLittleEndian(Int32(3780), to: &result)
	appendLittleEndian(Int32(3780), to: &result)
	appendLittleEndian(UInt32(0), to: &result)
	appendLittleEndian(UInt32(0), to: &result)

	// Positive-height BMP rows are stored bottom first; Quartz's bitmap buffer is top first.
	for y in (0..<height).reversed() {
		for x in 0..<width {
			let pixel = y * context.bytesPerRow + x * 4
			result.append(contentsOf: [pixels[pixel + 2], pixels[pixel + 1], pixels[pixel]])
		}
		result.append(contentsOf: repeatElement(UInt8(0), count: rowBytes - width * 3))
	}
	return result
}

private func generateInstallerBitmaps(glyph: CGImage, slogan: CGImage) throws {
	let header = try makeWindowsContext(width: 150, height: 57)
	header.setFillColor(NSColor.white.cgColor)
	header.fill(CGRect(x: 0, y: 0, width: 150, height: 57))
	header.draw(glyph, in: CGRect(x: 8, y: 16, width: 23, height: 25))
	header.draw(slogan, in: CGRect(x: 36, y: 10, width: 108, height: 36))
	try createBitmap24(context: header).write(
		to: resourcesDirectory.appendingPathComponent("installer-header-150x57.bmp"), options: .atomic,
	)

	let sidebar = try makeWindowsContext(width: 164, height: 314)
	sidebar.setFillColor(NSColor(srgbRed: 0.975, green: 0.975, blue: 0.975, alpha: 1).cgColor)
	sidebar.fill(CGRect(x: 0, y: 0, width: 164, height: 314))
	sidebar.draw(glyph, in: CGRect(x: 44, y: 167, width: 77, height: 84))
	sidebar.draw(slogan, in: CGRect(x: 4, y: 107, width: 156, height: 52))
	try createBitmap24(context: sidebar).write(
		to: resourcesDirectory.appendingPathComponent("installer-sidebar-164x314.bmp"), options: .atomic,
	)
}

private func generateWindowsAssets() throws {
	let logo = try loadImage(at: brandAssetsDirectory.appendingPathComponent("nobottomlogo.png"))
	let slogan = try loadImage(at: brandAssetsDirectory.appendingPathComponent("nobottomslogen.png"))
	// Crop only the source's transparent padding so every size retains the original mark.
	guard let glyph = logo.cropping(to: CGRect(x: 87, y: 37, width: 1079, height: 1179)) else {
		throw NSError(domain: "WenXueIconGenerator", code: 8)
	}
	let sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
	let frames = try sizes.map { size in
		(size: size, data: try renderWindowsIcon(glyph: glyph, size: size))
	}
	for frame in frames {
		try frame.data.write(
			to: resourcesDirectory.appendingPathComponent("app-icon-windows-\(frame.size).png"),
			options: .atomic,
		)
	}
	try createWindowsIco(frames: frames).write(to: windowsIcoURL, options: .atomic)
	try generateInstallerBitmaps(glyph: glyph, slogan: slogan)
	print("Generated Windows ICO, \(frames.count) PNG sizes, and NSIS header/sidebar BMPs")
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.isEmpty || arguments == ["--mac"] || arguments == ["--windows"] else {
	fputs("Usage: swift generate-app-icons.swift [--mac | --windows]\n", stderr)
	exit(1)
}

if arguments.isEmpty || arguments == ["--mac"] {
	try generateMacIcons(source: loadImage(at: sourceURL))
	print("Generated \(macMasterURL.lastPathComponent) and \(macIcnsURL.lastPathComponent)")
}
if arguments.isEmpty || arguments == ["--windows"] {
	try generateWindowsAssets()
}
