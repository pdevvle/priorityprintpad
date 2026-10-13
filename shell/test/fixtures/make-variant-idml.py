"""Variants of card-9x6.idml for shell/test/designer.e2e.mjs: what InDesign files bring that the
designer must make plain or refuse (no bleed, a wider page, parent-page items, non-printing layers
and objects, groups, both sides on one spread, a vertically centred frame).
usage (from the repo root): python3 shell/test/fixtures/make-variant-idml.py shell/test/fixtures
Writes variant-<name>.idml.
"""
import zipfile, sys, os
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'card-9x6.idml')
outdir = sys.argv[1]
zin = zipfile.ZipFile(src)

def rect(self_id, x0, y0, x1, y1, fill='Color/C=0 M=60 Y=100 K=0', layer='u1', extra=''):
    return f'''		<Rectangle Self="{self_id}" ContentType="Unassigned" Name="$ID/" ItemLayer="{layer}" Visible="true" Locked="false" Nonprinting="false" {extra} ItemTransform="1 0 0 1 -324 -216" FillColor="{fill}" FillTint="100" StrokeColor="Swatch/None" StrokeWeight="0">
			<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
				<PathPointType Anchor="{x0} {y0}" LeftDirection="{x0} {y0}" RightDirection="{x0} {y0}"/>
				<PathPointType Anchor="{x1} {y0}" LeftDirection="{x1} {y0}" RightDirection="{x1} {y0}"/>
				<PathPointType Anchor="{x1} {y1}" LeftDirection="{x1} {y1}" RightDirection="{x1} {y1}"/>
				<PathPointType Anchor="{x0} {y1}" LeftDirection="{x0} {y1}" RightDirection="{x0} {y1}"/>
			</PathPointArray></GeometryPathType></PathGeometry></Properties>
		</Rectangle>
'''

def tframe(self_id, story, x0, y0, x1, y1, layer='u1'):
    return f'''		<TextFrame Self="{self_id}" ParentStory="{story}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" Name="$ID/" ItemLayer="{layer}" Visible="true" Locked="false" Nonprinting="false" ItemTransform="1 0 0 1 -324 -216" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0">
			<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
				<PathPointType Anchor="{x0} {y0}" LeftDirection="{x0} {y0}" RightDirection="{x0} {y0}"/>
				<PathPointType Anchor="{x1} {y0}" LeftDirection="{x1} {y0}" RightDirection="{x1} {y0}"/>
				<PathPointType Anchor="{x1} {y1}" LeftDirection="{x1} {y1}" RightDirection="{x1} {y1}"/>
				<PathPointType Anchor="{x0} {y1}" LeftDirection="{x0} {y1}" RightDirection="{x0} {y1}"/>
			</PathPointArray></GeometryPathType></PathGeometry></Properties>
			<TextFramePreference TextColumnCount="1" AutoSizingType="Off"><Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties></TextFramePreference>
		</TextFrame>
'''

def story(self_id, text, size=24):
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="16.0">
	<Story Self="{self_id}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/">
		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="LeftAlign">
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" AppliedFont="Source Sans 3" FontStyle="Bold" PointSize="{size}"><Content>{text}</Content></CharacterStyleRange>
		</ParagraphStyleRange>
	</Story>
</idPkg:Story>'''

def write(name, edits, extra_files=None, designmap_fn=None):
    out = os.path.join(outdir, 'variant-' + name)
    zin = zipfile.ZipFile(src)
    zout = zipfile.ZipFile(out, 'w')
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename in edits:
            d = edits[i.filename](d)
        if i.filename == 'designmap.xml' and designmap_fn:
            d = designmap_fn(d)
        zout.writestr(i, d, compress_type=zipfile.ZIP_STORED if i.filename == 'mimetype' else zipfile.ZIP_DEFLATED)
    for fn, data in (extra_files or {}).items():
        zout.writestr(fn, data, compress_type=zipfile.ZIP_DEFLATED)
    zout.close()
    print('wrote', out)

add = lambda xml: (lambda d: d.replace(b'\t</Spread>', xml.encode() + b'\t</Spread>').replace(b'\t</MasterSpread>', xml.encode() + b'\t</MasterSpread>'))

# 1. master: a full-bleed teal background and a navy "logo" box on the A-Parent, nothing else changed
master_items = rect('um1', -9, -9, 657, 441, fill='Color/C=0 M=60 Y=100 K=0') + rect('um2', 480, 300, 620, 410, fill='Color/C=0 M=60 Y=100 K=0')
write('master.idml', {'MasterSpreads/MasterSpread_u3.xml': add(master_items)})

# 2. group: a group holding a text frame (with a long story) and a rectangle, on the front
grp = '''		<Group Self="ugrp" ItemLayer="u1" Visible="true" Locked="false" ItemTransform="1 0 0 1 0 0">
''' + tframe('ugt', 'ugs', 72, 260, 400, 330) + rect('ugr', 72, 340, 400, 400) + '''		</Group>
'''
def dm_group(d):
    return d.replace(b'<idPkg:Story src="Stories/Story_ua.xml"/>', b'<idPkg:Story src="Stories/Story_ua.xml"/><idPkg:Story src="Stories/Story_ugs.xml"/>')

# 3. layers: a visible but non-printing layer with a big rectangle, and a hidden layer with another
def dm_layers(d):
    return d.replace(b'<Layer Self="u1"', b'<Layer Self="uL2" Name="Notes" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="false"/><Layer Self="uL3" Name="Hidden" Visible="false" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/><Layer Self="u1"')
lay = rect('unp', 100, 100, 300, 200, layer='uL2') + rect('uhid', 350, 100, 550, 200, layer='uL3')
write('layers.idml', {'Spreads/Spread_u7.xml': add(lay)}, None, dm_layers)

# 4. nonprinting item
np_ = rect('unp2', 100, 260, 300, 400, extra='').replace('Nonprinting="false"', 'Nonprinting="true"')
write('nonprinting.idml', {'Spreads/Spread_u7.xml': add(np_)})

# 5. group whose text is overset (more words than the frame holds)
write('group-overset.idml', {'Spreads/Spread_u7.xml': add(grp)}, {'Stories/Story_ugs.xml': story('ugs', 'Grouped words that do not fit. ' * 12 + 'LASTWORDS', 24)}, dm_group)
# 6. group whose text frame crosses the right-hand cut line
grp2 = '''		<Group Self="ugrp" ItemLayer="u1" Visible="true" Locked="false" ItemTransform="1 0 0 1 0 0">
''' + tframe('ugt', 'ugs', 450, 260, 700, 330) + rect('ugr', 450, 340, 600, 400) + '''		</Group>
'''
write('group-edge.idml', {'Spreads/Spread_u7.xml': add(grp2)}, {'Stories/Story_ugs.xml': story('ugs', 'EDGEWORDS cut off by the knife here', 24)}, dm_group)

# 7. no bleed set in InDesign (a common omission); 8. a quarter-inch bleed; 9. a page 1.5 pt wider
def prefs(fn):
    return lambda d: fn(d)
nob = lambda d: d.replace(b'BleedTopOffset="9"', b'BleedTopOffset="0"').replace(b'BleedBottomOffset="9"', b'BleedBottomOffset="0"').replace(b'BleedInsideOrLeftOffset="9"', b'BleedInsideOrLeftOffset="0"').replace(b'BleedOutsideOrRightOffset="9"', b'BleedOutsideOrRightOffset="0"')
b18 = lambda d: d.replace(b'Offset="9"', b'Offset="18"')
write('nobleed.idml', {'Resources/Preferences.xml': nob})
write('bleed18.idml', {'Resources/Preferences.xml': b18})
w15 = lambda d: d.replace(b'PageWidth="648"', b'PageWidth="649.5"')
gb = lambda d: d.replace(b'GeometricBounds="0 0 432 648"', b'GeometricBounds="0 0 432 649.5"')
write('wide15.idml', {'Resources/Preferences.xml': w15, 'Spreads/Spread_u7.xml': gb, 'Spreads/Spread_u8.xml': gb, 'MasterSpreads/MasterSpread_u3.xml': gb})
import re as _re
strip_rect = lambda d: _re.sub(rb'\t\t<Rectangle Self="ub".*?</Rectangle>\n', b'', d, flags=_re.S)
write('master2.idml', {'MasterSpreads/MasterSpread_u3.xml': add(master_items), 'Spreads/Spread_u8.xml': strip_rect})
vc = lambda d: d.replace(b'VerticalJustification="TopAlign"', b'VerticalJustification="CenterAlign"').replace(b'Anchor="72 150" LeftDirection="72 150" RightDirection="72 150"', b'Anchor="72 60" LeftDirection="72 60" RightDirection="72 60"').replace(b'Anchor="576 150" LeftDirection="576 150" RightDirection="576 150"', b'Anchor="576 60" LeftDirection="576 60" RightDirection="576 60"').replace(b'Anchor="576 230" LeftDirection="576 230" RightDirection="576 230"', b'Anchor="576 372" LeftDirection="576 372" RightDirection="576 372"').replace(b'Anchor="72 230" LeftDirection="72 230" RightDirection="72 230"', b'Anchor="72 372" LeftDirection="72 372" RightDirection="72 372"')
write('vcenter.idml', {'Spreads/Spread_u7.xml': vc})

# 10. both sides on ONE spread (front and back side by side)
def one_spread(d):
    d = d.replace(b'PageCount="1"', b'PageCount="2"')
    d = d.replace(b'<Page Self="u4" Name="1" AppliedMaster="u3" OverrideList="" GeometricBounds="0 0 432 648" ItemTransform="1 0 0 1 -324 -216">',
                  b'<Page Self="u4" Name="1" AppliedMaster="u3" OverrideList="" GeometricBounds="0 0 432 648" ItemTransform="1 0 0 1 -648 -216">')
    p2 = b'''		<Page Self="u5" Name="2" AppliedMaster="u3" OverrideList="" GeometricBounds="0 0 432 648" ItemTransform="1 0 0 1 0 -216">
			<MarginPreference ColumnCount="1" ColumnGutter="12" Top="9" Bottom="9" Left="9" Right="9" ColumnDirection="Horizontal" ColumnsPositions="0 630"/>
		</Page>
'''
    d = d.replace(b'\t\t<TextFrame Self="u9"', p2 + b'\t\t<TextFrame Self="u9"', 1)
    d = d.replace(b'ItemTransform="1 0 0 1 -324 -216" FillColor="Swatch/None" FillTint="100" OverprintFill="false" StrokeColor="Swatch/None" StrokeWeight="0"', b'ItemTransform="1 0 0 1 -648 -216" FillColor="Swatch/None" FillTint="100" OverprintFill="false" StrokeColor="Swatch/None" StrokeWeight="0"', 1)
    # the back's orange background, on page 2 of this spread
    d = d.replace(b'\t</Spread>', rect('uback', 0, 0, 648, 432).replace('-324 -216', '0 -216').encode() + b'\t</Spread>')
    return d
dm1 = lambda d: d.replace(b'<idPkg:Spread src="Spreads/Spread_u8.xml"/>', b'')
write('onespread.idml', {'Spreads/Spread_u7.xml': one_spread}, None, dm1)
