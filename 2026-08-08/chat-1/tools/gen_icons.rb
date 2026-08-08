#!/usr/bin/env ruby
# 生成 Uncle3 插件图标：蓝色圆角方块 + 白色字母 U
# 用法: ruby tools/gen_icons.rb <输出目录>
require 'zlib'

OUT = ARGV[0] or abort('usage: gen_icons.rb <dir>')
BG = [37, 99, 235]   # #2563eb

# 5x7 点阵字母 U
U = [
  '10001',
  '10001',
  '10001',
  '10001',
  '10001',
  '10001',
  '01110'
]

def rounded_rect_alpha(x, y, s)
  # 像素中心到圆角矩形的 SDF，输出 0..1 覆盖度
  r = s * 0.22
  hw = s / 2.0
  px = (x + 0.5 - hw).abs - (hw - r)
  py = (y + 0.5 - hw).abs - (hw - r)
  px = 0.0 if px < 0
  py = 0.0 if py < 0
  d = Math.sqrt(px * px + py * py) - r
  a = 0.5 - d
  a.clamp(0.0, 1.0)
end

def letter_alpha(x, y, s)
  # 点阵 U 居中，cell 大小约为 s/11
  cell = s / 11.0
  ox = (s - 5 * cell) / 2.0
  oy = (s - 7 * cell) / 2.0
  cx = ((x + 0.5 - ox) / cell).floor
  cy = ((y + 0.5 - oy) / cell).floor
  return 0.0 if cx < 0 || cx > 4 || cy < 0 || cy > 6
  U[cy][cx] == '1' ? 1.0 : 0.0
end

def chunk(type, data)
  type = type.b
  [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N')
end

def write_png(path, s)
  raw = String.new(encoding: 'BINARY')
  s.times do |y|
    raw << 0.chr # filter none
    s.times do |x|
      a_bg = rounded_rect_alpha(x, y, s)
      a_l = letter_alpha(x, y, s) * a_bg
      # 合成：背景蓝色，字母白色
      r = (BG[0] * (1 - a_l) + 255 * a_l).round
      g = (BG[1] * (1 - a_l) + 255 * a_l).round
      b = (BG[2] * (1 - a_l) + 255 * a_l).round
      raw << [r, g, b, (a_bg * 255).round].pack('C4')
    end
  end
  ihdr = [s, s, 8, 6, 0, 0, 0].pack('N2C5')
  png = "\x89PNG\r\n\x1a\n".b + chunk('IHDR', ihdr) + chunk('IDAT', Zlib::Deflate.deflate(raw)) + chunk('IEND', '')
  File.binwrite(path, png)
  puts "written #{path}"
end

[16, 32, 48, 128].each { |s| write_png(File.join(OUT, "icon#{s}.png"), s) }
