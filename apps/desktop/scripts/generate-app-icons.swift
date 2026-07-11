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
private let windowsMasterURL = resourcesDirectory.appendingPathComponent("app-icon-windows-256.png")
private let windowsIcoURL = resourcesDirectory.appendingPathComponent("app-icon-windows.ico")

private let macStyle = IconStyle(visibleFraction: 824 / 1024, shadow: true)
private let windowsStyle = IconStyle(visibleFraction: 40 / 48, shadow: false)

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

private func generateWindowsIcons(source: CGImage) throws {
	let sizes = [16, 20, 24, 32, 40, 48, 64, 256]
	let frames = try sizes.map { size in
		(size: size, data: try renderIcon(source: source, size: size, style: windowsStyle))
	}
	try frames.last!.data.write(to: windowsMasterURL, options: .atomic)
	try createWindowsIco(frames: frames).write(to: windowsIcoURL, options: .atomic)
}

guard
	let sourceImage = NSImage(contentsOf: sourceURL),
	let source = sourceImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
	fatalError("Unable to read \(sourceURL.path)")
}

try generateMacIcons(source: source)
try generateWindowsIcons(source: source)

print("Generated \(macMasterURL.lastPathComponent), \(macIcnsURL.lastPathComponent), " +
	"\(windowsMasterURL.lastPathComponent), and \(windowsIcoURL.lastPathComponent)")
