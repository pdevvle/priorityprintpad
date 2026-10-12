"""Builds card-9x6-mixed.idml for shell/test/designer.e2e.mjs from card-9x6.idml: the headline story
becomes three runs (Arial 24 pt, which the designer does not have; Source Sans 3 Bold 36 pt; Source
Serif 4 Italic 18 pt), and the front gains a photo frame linked to a file that is not in the package.

    python3 shell/test/fixtures/make-mixed-idml.py      (from the repo root)
"""
import zipfile, sys
src='shell/test/fixtures/card-9x6.idml'
out='shell/test/fixtures/card-9x6-mixed.idml'
zin=zipfile.ZipFile(src)
story='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="16.0">
	<Story Self="ua" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/">
		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="CenterAlign">
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" AppliedFont="Arial" FontStyle="Regular" PointSize="24"><Content>Arial words then </Content></CharacterStyleRange>
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" AppliedFont="Source Sans 3" FontStyle="Bold" PointSize="36" FillColor="Color/C=0 M=60 Y=100 K=0"><Content>BIG ORANGE</Content></CharacterStyleRange>
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" AppliedFont="Source Serif 4" FontStyle="Italic" PointSize="18"><Content> and serif italic</Content></CharacterStyleRange>
		</ParagraphStyleRange>
	</Story>
</idPkg:Story>'''
img='''		<Rectangle Self="uimg" ContentType="GraphicType" Name="$ID/" ItemLayer="u1" Visible="true" Locked="false" Nonprinting="false" ItemTransform="1 0 0 1 -324 -216" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0">
			<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
				<PathPointType Anchor="72 260" LeftDirection="72 260" RightDirection="72 260"/>
				<PathPointType Anchor="272 260" LeftDirection="272 260" RightDirection="272 260"/>
				<PathPointType Anchor="272 400" LeftDirection="272 400" RightDirection="272 400"/>
				<PathPointType Anchor="72 400" LeftDirection="72 400" RightDirection="72 400"/>
			</PathPointArray></GeometryPathType></PathGeometry></Properties>
			<Image Self="uimgi" ItemTransform="1 0 0 1 72 260" ImageTypeName="$ID/JPEG" EffectivePpi="300 300" ActualPpi="300 300">
				<Properties><Profile type="string">$ID/None</Profile><GraphicBounds Left="0" Top="0" Right="200" Bottom="140"/></Properties>
				<Link Self="ulink" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="file:/C:/Users/me/Pictures/logo.jpg" LinkResourceFormat="$ID/JPEG" StoredState="Normal" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport" LinkImportStamp="file 0 0" LinkImportModificationTime="2026-01-01T00:00:00" LinkImportTime="2026-01-01T00:00:00" LinkResourceSize="0~0"/>
			</Image>
		</Rectangle>
'''
zout=zipfile.ZipFile(out,'w')
for i in zin.infolist():
    d=zin.read(i.filename)
    if i.filename=='Stories/Story_ua.xml': d=story.encode()
    if i.filename=='Spreads/Spread_u7.xml': d=d.replace(b'\t</Spread>', img.encode()+b'\t</Spread>')
    zout.writestr(i, d, compress_type=zipfile.ZIP_STORED if i.filename=='mimetype' else zipfile.ZIP_DEFLATED)
zout.close()
