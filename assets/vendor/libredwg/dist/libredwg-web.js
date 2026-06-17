var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import createModule from "../wasm/libredwg-web.js";
import { default as default2 } from "../wasm/libredwg-web.js";
var DwgCodePage = /* @__PURE__ */ ((DwgCodePage2) => {
  DwgCodePage2[DwgCodePage2["CP_UTF8"] = 0] = "CP_UTF8";
  DwgCodePage2[DwgCodePage2["CP_US_ASCII"] = 1] = "CP_US_ASCII";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_1"] = 2] = "CP_ISO_8859_1";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_2"] = 3] = "CP_ISO_8859_2";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_3"] = 4] = "CP_ISO_8859_3";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_4"] = 5] = "CP_ISO_8859_4";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_5"] = 6] = "CP_ISO_8859_5";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_6"] = 7] = "CP_ISO_8859_6";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_7"] = 8] = "CP_ISO_8859_7";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_8"] = 9] = "CP_ISO_8859_8";
  DwgCodePage2[DwgCodePage2["CP_ISO_8859_9"] = 10] = "CP_ISO_8859_9";
  DwgCodePage2[DwgCodePage2["CP_CP437"] = 11] = "CP_CP437";
  DwgCodePage2[DwgCodePage2["CP_CP850"] = 12] = "CP_CP850";
  DwgCodePage2[DwgCodePage2["CP_CP852"] = 13] = "CP_CP852";
  DwgCodePage2[DwgCodePage2["CP_CP855"] = 14] = "CP_CP855";
  DwgCodePage2[DwgCodePage2["CP_CP857"] = 15] = "CP_CP857";
  DwgCodePage2[DwgCodePage2["CP_CP860"] = 16] = "CP_CP860";
  DwgCodePage2[DwgCodePage2["CP_CP861"] = 17] = "CP_CP861";
  DwgCodePage2[DwgCodePage2["CP_CP863"] = 18] = "CP_CP863";
  DwgCodePage2[DwgCodePage2["CP_CP864"] = 19] = "CP_CP864";
  DwgCodePage2[DwgCodePage2["CP_CP865"] = 20] = "CP_CP865";
  DwgCodePage2[DwgCodePage2["CP_CP869"] = 21] = "CP_CP869";
  DwgCodePage2[DwgCodePage2["CP_CP932"] = 22] = "CP_CP932";
  DwgCodePage2[DwgCodePage2["CP_MACINTOSH"] = 23] = "CP_MACINTOSH";
  DwgCodePage2[DwgCodePage2["CP_BIG5"] = 24] = "CP_BIG5";
  DwgCodePage2[DwgCodePage2["CP_CP949"] = 25] = "CP_CP949";
  DwgCodePage2[DwgCodePage2["CP_JOHAB"] = 26] = "CP_JOHAB";
  DwgCodePage2[DwgCodePage2["CP_CP866"] = 27] = "CP_CP866";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1250"] = 28] = "CP_ANSI_1250";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1251"] = 29] = "CP_ANSI_1251";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1252"] = 30] = "CP_ANSI_1252";
  DwgCodePage2[DwgCodePage2["CP_GB2312"] = 31] = "CP_GB2312";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1253"] = 32] = "CP_ANSI_1253";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1254"] = 33] = "CP_ANSI_1254";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1255"] = 34] = "CP_ANSI_1255";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1256"] = 35] = "CP_ANSI_1256";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1257"] = 36] = "CP_ANSI_1257";
  DwgCodePage2[DwgCodePage2["CP_ANSI_874"] = 37] = "CP_ANSI_874";
  DwgCodePage2[DwgCodePage2["CP_ANSI_932"] = 38] = "CP_ANSI_932";
  DwgCodePage2[DwgCodePage2["CP_ANSI_936"] = 39] = "CP_ANSI_936";
  DwgCodePage2[DwgCodePage2["CP_ANSI_949"] = 40] = "CP_ANSI_949";
  DwgCodePage2[DwgCodePage2["CP_ANSI_950"] = 41] = "CP_ANSI_950";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1361"] = 42] = "CP_ANSI_1361";
  DwgCodePage2[DwgCodePage2["CP_UTF16"] = 43] = "CP_UTF16";
  DwgCodePage2[DwgCodePage2["CP_ANSI_1258"] = 44] = "CP_ANSI_1258";
  DwgCodePage2[DwgCodePage2["CP_UNDEFINED"] = 255] = "CP_UNDEFINED";
  return DwgCodePage2;
})(DwgCodePage || {});
const encodings = [
  "utf-8",
  // 0
  "utf-8",
  // US ASCII
  "iso-8859-1",
  "iso-8859-2",
  "iso-8859-3",
  "iso-8859-4",
  "iso-8859-5",
  "iso-8859-6",
  "iso-8859-7",
  "iso-8859-8",
  "iso-8859-9",
  // 10
  "utf-8",
  // DOS English
  "utf-8",
  // 12 DOS Latin-1
  "utf-8",
  // DOS Central European
  "utf-8",
  // DOS Cyrillic
  "utf-8",
  // DOS Turkish
  "utf-8",
  // DOS Portoguese
  "utf-8",
  // DOS Icelandic
  "utf-8",
  // DOS Hebrew
  "utf-8",
  // DOS Arabic (IBM)
  "utf-8",
  // DOS Nordic
  "utf-8",
  // DOS Greek
  "shift-jis",
  // DOS Japanese (shiftjis)
  "macintosh",
  // 23
  "big5",
  "utf-8",
  // Korean (Wansung + Johab)
  "utf-8",
  // Johab?
  "ibm866",
  // Russian
  "windows-1250",
  // Central + Eastern European
  "windows-1251",
  // Cyrillic
  "windows-1252",
  // Western European
  "gbk",
  // EUC-CN Chinese
  "windows-1253",
  // Greek
  "windows-1254",
  // Turkish
  "windows-1255",
  // Hebrew
  "windows-1256",
  // Arabic
  "windows-1257",
  // Baltic
  "windows-874",
  // Thai
  "shift-jis",
  // 38 Japanese (extended shiftjis, windows-31j)
  "gbk",
  // 39 Simplified Chinese
  "euc-kr",
  // 40 Korean Wansung
  "big5",
  // 41 Trad Chinese
  "utf-8",
  // 42 Korean Wansung
  "utf-16le",
  "windows-1258"
  // Vietnamese
];
const dwgCodePageToEncoding = (codepage) => {
  return encodings[codepage];
};
var DwgDimensionType = /* @__PURE__ */ ((DwgDimensionType2) => {
  DwgDimensionType2[DwgDimensionType2["Rotated"] = 0] = "Rotated";
  DwgDimensionType2[DwgDimensionType2["Aligned"] = 1] = "Aligned";
  DwgDimensionType2[DwgDimensionType2["Angular"] = 2] = "Angular";
  DwgDimensionType2[DwgDimensionType2["Diameter"] = 3] = "Diameter";
  DwgDimensionType2[DwgDimensionType2["Radius"] = 4] = "Radius";
  DwgDimensionType2[DwgDimensionType2["Angular3Point"] = 5] = "Angular3Point";
  DwgDimensionType2[DwgDimensionType2["Ordinate"] = 6] = "Ordinate";
  DwgDimensionType2[DwgDimensionType2["ReferenceIsExclusive"] = 32] = "ReferenceIsExclusive";
  DwgDimensionType2[DwgDimensionType2["IsOrdinateXTypeFlag"] = 64] = "IsOrdinateXTypeFlag";
  DwgDimensionType2[DwgDimensionType2["IsCustomTextPositionFlag"] = 128] = "IsCustomTextPositionFlag";
  return DwgDimensionType2;
})(DwgDimensionType || {});
var DwgAttachmentPoint = /* @__PURE__ */ ((DwgAttachmentPoint2) => {
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopLeft"] = 1] = "TopLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopCenter"] = 2] = "TopCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["TopRight"] = 3] = "TopRight";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleLeft"] = 4] = "MiddleLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleCenter"] = 5] = "MiddleCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["MiddleRight"] = 6] = "MiddleRight";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomLeft"] = 7] = "BottomLeft";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomCenter"] = 8] = "BottomCenter";
  DwgAttachmentPoint2[DwgAttachmentPoint2["BottomRight"] = 9] = "BottomRight";
  return DwgAttachmentPoint2;
})(DwgAttachmentPoint || {});
var DwgDimensionTextLineSpacing = /* @__PURE__ */ ((DwgDimensionTextLineSpacing2) => {
  DwgDimensionTextLineSpacing2[DwgDimensionTextLineSpacing2["AtLeast"] = 1] = "AtLeast";
  DwgDimensionTextLineSpacing2[DwgDimensionTextLineSpacing2["Exact"] = 2] = "Exact";
  return DwgDimensionTextLineSpacing2;
})(DwgDimensionTextLineSpacing || {});
var DwgDimensionTextVertical = /* @__PURE__ */ ((DwgDimensionTextVertical2) => {
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Center"] = 0] = "Center";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Above"] = 1] = "Above";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Outside"] = 2] = "Outside";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["JIS"] = 3] = "JIS";
  DwgDimensionTextVertical2[DwgDimensionTextVertical2["Below"] = 4] = "Below";
  return DwgDimensionTextVertical2;
})(DwgDimensionTextVertical || {});
var DwgDimensionZeroSuppression = /* @__PURE__ */ ((DwgDimensionZeroSuppression2) => {
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Feet"] = 0] = "Feet";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["None"] = 1] = "None";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Inch"] = 2] = "Inch";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["FeetAndInch"] = 3] = "FeetAndInch";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Leading"] = 4] = "Leading";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["Trailing"] = 8] = "Trailing";
  DwgDimensionZeroSuppression2[DwgDimensionZeroSuppression2["LeadingAndTrailing"] = 12] = "LeadingAndTrailing";
  return DwgDimensionZeroSuppression2;
})(DwgDimensionZeroSuppression || {});
var DwgDimensionZeroSuppressionAngular = /* @__PURE__ */ ((DwgDimensionZeroSuppressionAngular2) => {
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["None"] = 0] = "None";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["Leading"] = 1] = "Leading";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["Trailing"] = 2] = "Trailing";
  DwgDimensionZeroSuppressionAngular2[DwgDimensionZeroSuppressionAngular2["LeadingAndTrailing"] = 3] = "LeadingAndTrailing";
  return DwgDimensionZeroSuppressionAngular2;
})(DwgDimensionZeroSuppressionAngular || {});
var DwgDimensionTextHorizontal = /* @__PURE__ */ ((DwgDimensionTextHorizontal2) => {
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Center"] = 0] = "Center";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Left"] = 1] = "Left";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["Right"] = 2] = "Right";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["OverFirst"] = 3] = "OverFirst";
  DwgDimensionTextHorizontal2[DwgDimensionTextHorizontal2["OverSecond"] = 4] = "OverSecond";
  return DwgDimensionTextHorizontal2;
})(DwgDimensionTextHorizontal || {});
var DwgDimensionToleranceTextVertical = /* @__PURE__ */ ((DwgDimensionToleranceTextVertical2) => {
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Bottom"] = 0] = "Bottom";
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Center"] = 1] = "Center";
  DwgDimensionToleranceTextVertical2[DwgDimensionToleranceTextVertical2["Top"] = 2] = "Top";
  return DwgDimensionToleranceTextVertical2;
})(DwgDimensionToleranceTextVertical || {});
var DwgHatchSolidFill = /* @__PURE__ */ ((DwgHatchSolidFill2) => {
  DwgHatchSolidFill2[DwgHatchSolidFill2["PatternFill"] = 0] = "PatternFill";
  DwgHatchSolidFill2[DwgHatchSolidFill2["SolidFill"] = 1] = "SolidFill";
  return DwgHatchSolidFill2;
})(DwgHatchSolidFill || {});
var DwgHatchAssociativity = /* @__PURE__ */ ((DwgHatchAssociativity2) => {
  DwgHatchAssociativity2[DwgHatchAssociativity2["NonAssociative"] = 0] = "NonAssociative";
  DwgHatchAssociativity2[DwgHatchAssociativity2["Associative"] = 1] = "Associative";
  return DwgHatchAssociativity2;
})(DwgHatchAssociativity || {});
var DwgHatchStyle = /* @__PURE__ */ ((DwgHatchStyle2) => {
  DwgHatchStyle2[DwgHatchStyle2["Normal"] = 0] = "Normal";
  DwgHatchStyle2[DwgHatchStyle2["Outer"] = 1] = "Outer";
  DwgHatchStyle2[DwgHatchStyle2["Ignore"] = 2] = "Ignore";
  return DwgHatchStyle2;
})(DwgHatchStyle || {});
var DwgHatchPatternType = /* @__PURE__ */ ((DwgHatchPatternType2) => {
  DwgHatchPatternType2[DwgHatchPatternType2["UserDefined"] = 0] = "UserDefined";
  DwgHatchPatternType2[DwgHatchPatternType2["Predefined"] = 1] = "Predefined";
  DwgHatchPatternType2[DwgHatchPatternType2["Custom"] = 2] = "Custom";
  return DwgHatchPatternType2;
})(DwgHatchPatternType || {});
var DwgHatchBoundaryAnnotation = /* @__PURE__ */ ((DwgHatchBoundaryAnnotation2) => {
  DwgHatchBoundaryAnnotation2[DwgHatchBoundaryAnnotation2["NotAnnotated"] = 0] = "NotAnnotated";
  DwgHatchBoundaryAnnotation2[DwgHatchBoundaryAnnotation2["Annotated"] = 1] = "Annotated";
  return DwgHatchBoundaryAnnotation2;
})(DwgHatchBoundaryAnnotation || {});
var DwgHatchGradientFlag = /* @__PURE__ */ ((DwgHatchGradientFlag2) => {
  DwgHatchGradientFlag2[DwgHatchGradientFlag2["Solid"] = 0] = "Solid";
  DwgHatchGradientFlag2[DwgHatchGradientFlag2["Gradient"] = 1] = "Gradient";
  return DwgHatchGradientFlag2;
})(DwgHatchGradientFlag || {});
var DwgHatchGradientColorFlag = /* @__PURE__ */ ((DwgHatchGradientColorFlag2) => {
  DwgHatchGradientColorFlag2[DwgHatchGradientColorFlag2["TwoColor"] = 0] = "TwoColor";
  DwgHatchGradientColorFlag2[DwgHatchGradientColorFlag2["OneColor"] = 1] = "OneColor";
  return DwgHatchGradientColorFlag2;
})(DwgHatchGradientColorFlag || {});
var DwgBoundaryPathTypeFlag = /* @__PURE__ */ ((DwgBoundaryPathTypeFlag2) => {
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Default"] = 0] = "Default";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["External"] = 1] = "External";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Polyline"] = 2] = "Polyline";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Derived"] = 4] = "Derived";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Textbox"] = 8] = "Textbox";
  DwgBoundaryPathTypeFlag2[DwgBoundaryPathTypeFlag2["Outermost"] = 16] = "Outermost";
  return DwgBoundaryPathTypeFlag2;
})(DwgBoundaryPathTypeFlag || {});
var DwgBoundaryPathEdgeType = /* @__PURE__ */ ((DwgBoundaryPathEdgeType2) => {
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Line"] = 1] = "Line";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Circular"] = 2] = "Circular";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Elliptic"] = 3] = "Elliptic";
  DwgBoundaryPathEdgeType2[DwgBoundaryPathEdgeType2["Spline"] = 4] = "Spline";
  return DwgBoundaryPathEdgeType2;
})(DwgBoundaryPathEdgeType || {});
var DwgPolylineFlag = /* @__PURE__ */ ((DwgPolylineFlag2) => {
  DwgPolylineFlag2[DwgPolylineFlag2["CLOSED_POLYLINE"] = 1] = "CLOSED_POLYLINE";
  DwgPolylineFlag2[DwgPolylineFlag2["CURVE_FIT"] = 2] = "CURVE_FIT";
  DwgPolylineFlag2[DwgPolylineFlag2["SPLINE_FIT"] = 4] = "SPLINE_FIT";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYLINE_3D"] = 8] = "POLYLINE_3D";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYGON_3D"] = 16] = "POLYGON_3D";
  DwgPolylineFlag2[DwgPolylineFlag2["CLOSED_POLYGON"] = 32] = "CLOSED_POLYGON";
  DwgPolylineFlag2[DwgPolylineFlag2["POLYFACE"] = 64] = "POLYFACE";
  DwgPolylineFlag2[DwgPolylineFlag2["CONTINUOUS"] = 128] = "CONTINUOUS";
  return DwgPolylineFlag2;
})(DwgPolylineFlag || {});
var DwgSmoothType = /* @__PURE__ */ ((DwgSmoothType2) => {
  DwgSmoothType2[DwgSmoothType2["NONE"] = 0] = "NONE";
  DwgSmoothType2[DwgSmoothType2["QUADRATIC"] = 5] = "QUADRATIC";
  DwgSmoothType2[DwgSmoothType2["CUBIC"] = 6] = "CUBIC";
  DwgSmoothType2[DwgSmoothType2["BEZIER"] = 8] = "BEZIER";
  return DwgSmoothType2;
})(DwgSmoothType || {});
var DwgProxyOriginalDataFormat = /* @__PURE__ */ ((DwgProxyOriginalDataFormat2) => {
  DwgProxyOriginalDataFormat2[DwgProxyOriginalDataFormat2["Dwg"] = 0] = "Dwg";
  DwgProxyOriginalDataFormat2[DwgProxyOriginalDataFormat2["Dxf"] = 1] = "Dxf";
  return DwgProxyOriginalDataFormat2;
})(DwgProxyOriginalDataFormat || {});
var DwgTextGenerationFlag = /* @__PURE__ */ ((DwgTextGenerationFlag2) => {
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["NONE"] = 0] = "NONE";
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["MIRRORED_X"] = 2] = "MIRRORED_X";
  DwgTextGenerationFlag2[DwgTextGenerationFlag2["MIRRORED_Y"] = 4] = "MIRRORED_Y";
  return DwgTextGenerationFlag2;
})(DwgTextGenerationFlag || {});
var DwgTextHorizontalAlign = /* @__PURE__ */ ((DwgTextHorizontalAlign2) => {
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["LEFT"] = 0] = "LEFT";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["CENTER"] = 1] = "CENTER";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["RIGHT"] = 2] = "RIGHT";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["ALIGNED"] = 3] = "ALIGNED";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["MIDDLE"] = 4] = "MIDDLE";
  DwgTextHorizontalAlign2[DwgTextHorizontalAlign2["FIT"] = 5] = "FIT";
  return DwgTextHorizontalAlign2;
})(DwgTextHorizontalAlign || {});
var DwgTextVerticalAlign = /* @__PURE__ */ ((DwgTextVerticalAlign2) => {
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["BASELINE"] = 0] = "BASELINE";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["BOTTOM"] = 1] = "BOTTOM";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["MIDDLE"] = 2] = "MIDDLE";
  DwgTextVerticalAlign2[DwgTextVerticalAlign2["TOP"] = 3] = "TOP";
  return DwgTextVerticalAlign2;
})(DwgTextVerticalAlign || {});
const HEADER_VARIABLES = Object.freeze([
  "ACADMAINTVER",
  "ACADVER",
  "ANGBASE",
  "ANGDIR",
  "ATTMODE",
  "AUNITS",
  "AUPREC",
  "CECOLOR",
  "CELTSCALE",
  "CELTYPE",
  "CELWEIGHT",
  "CEPSNID",
  "CEPSNTYPE",
  "CHAMFERA",
  "CHAMFERB",
  "CHAMFERC",
  "CHAMFERD",
  "CLAYER",
  "CMLJUST",
  "CMLSCALE",
  "CMLSTYLE",
  "CSHADOW",
  "DIMADEC",
  "DIMALT",
  "DIMALTD",
  "DIMALTF",
  "DIMALTRND",
  "DIMALTTD",
  "DIMALTTZ",
  "DIMALTU",
  "DIMALTZ",
  "DIMAPOST",
  "DIMASO",
  "DIMASSOC",
  "DIMASZ",
  "DIMATFIT",
  "DIMAUNIT",
  "DIMAZIN",
  "DIMBLK",
  "DIMBLK1",
  "DIMBLK2",
  "DIMCEN",
  "DIMCLRD",
  "DIMCLRE",
  "DIMCLRT",
  "DIMDEC",
  "DIMDLE",
  "DIMDLI",
  "DIMDSEP",
  "DIMEXE",
  "DIMEXO",
  "DIMFAC",
  "DIMGAP",
  "DIMJUST",
  "DIMLDRBLK",
  "DIMLFAC",
  "DIMLIM",
  "DIMLUNIT",
  "DIMLWD",
  "DIMLWE",
  "DIMPOST",
  "DIMRND",
  "DIMSAH",
  "DIMSCALE",
  "DIMSD1",
  "DIMSD2",
  "DIMSE1",
  "DIMSE2",
  "DIMSHO",
  "DIMSOXD",
  "DIMSTYLE",
  "DIMTAD",
  "DIMTDEC",
  "DIMTFAC",
  "DIMTIH",
  "DIMTIX",
  "DIMTM",
  "DIMTMOVE",
  "DIMTOFL",
  "DIMTOH",
  "DIMTOL",
  "DIMTOLJ",
  "DIMTP",
  "DIMTSZ",
  "DIMTVP",
  "DIMTXSTY",
  "DIMTXT",
  "DIMTZIN",
  "DIMUPT",
  "DIMZIN",
  "DISPSILH",
  "DRAGVS",
  "DWGCODEPAGE",
  "ELEVATION",
  "ENDCAPS",
  "EXTMAX",
  "EXTMIN",
  "EXTNAMES",
  "FILLETRAD",
  "FILLMODE",
  "FINGERPRINTGUID",
  "HALOGAP",
  "HANDSEED",
  "HIDETEXT",
  "HYPERLINKBASE",
  "INDEXCTL",
  "INSBASE",
  "INSUNITS",
  "INTERFERECOLOR",
  "INTERFEREOBJVS",
  "INTERFEREVPVS",
  "INTERSECTIONCOLOR",
  "INTERSECTIONDISPLAY",
  "JOINSTYLE",
  "LIMCHECK",
  "LIMMAX",
  "LIMMIN",
  "LTSCALE",
  "LUNITS",
  "LUPREC",
  "LWDISPLAY",
  "MAXACTVP",
  "MEASUREMENT",
  "MENU",
  "MIRRTEXT",
  "OBSCOLOR",
  "OBSLTYPE",
  "ORTHOMODE",
  "PDMODE",
  "PDSIZE",
  "PELEVATION",
  "PEXTMAX",
  "PEXTMIN",
  "PINSBASE",
  "PLIMCHECK",
  "PLIMMAX",
  "PLIMMIN",
  "PLINEGEN",
  "PLINEWID",
  "PROJECTNAME",
  "PROXYGRAPHICS",
  "PSLTSCALE",
  "PSTYLEMODE",
  "PSVPSCALE",
  "PUCSBASE",
  "PUCSNAME",
  "PUCSORG",
  "PUCSORGBACK",
  "PUCSORGBOTTOM",
  "PUCSORGFRONT",
  "PUCSORGLEFT",
  "PUCSORGRIGHT",
  "PUCSORGTOP",
  "PUCSORTHOREF",
  "PUCSORTHOVIEW",
  "PUCSXDIR",
  "PUCSYDIR",
  "QTEXTMODE",
  "REGENMODE",
  "SHADEDGE",
  "SHADEDIF",
  "SHADOWPLANELOCATION",
  "SKETCHINC",
  "SKPOLY",
  "SORTENTS",
  "SPLINESEGS",
  "SPLINETYPE",
  "SURFTAB1",
  "SURFTAB2",
  "SURFTYPE",
  "SURFU",
  "SURFV",
  "TDCREATE",
  "TDINDWG",
  "TDUCREATE",
  "TDUPDATE",
  "TDUSRTIMER",
  "TDUUPDATE",
  "TEXTSIZE",
  "TEXTSTYLE",
  "THICKNESS",
  "TILEMODE",
  "TRACEWID",
  "TREEDEPTH",
  "UCSBASE",
  "UCSNAME",
  "UCSORG",
  "UCSORGBACK",
  "UCSORGBOTTOM",
  "UCSORGFRONT",
  "UCSORGLEFT",
  "UCSORGRIGHT",
  "UCSORGTOP",
  "UCSORTHOREF",
  "UCSORTHOVIEW",
  "UCSXDIR",
  "UCSYDIR",
  "UNITMODE",
  "USERI1",
  "USERI2",
  "USERI3",
  "USERI4",
  "USERI5",
  "USERR1",
  "USERR2",
  "USERR3",
  "USERR4",
  "USERR5",
  "USRTIMER",
  "VERSIONGUID",
  "VISRETAIN",
  "WORLDVIEW",
  "XCLIPFRAME",
  "XEDIT"
]);
var DwgDictionaryCloningFlags = /* @__PURE__ */ ((DwgDictionaryCloningFlags2) => {
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["NotApplicable"] = 0] = "NotApplicable";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["KeepExisting"] = 1] = "KeepExisting";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["UseClone"] = 2] = "UseClone";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["XrefName"] = 3] = "XrefName";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["Name"] = 4] = "Name";
  DwgDictionaryCloningFlags2[DwgDictionaryCloningFlags2["UnmangleName"] = 5] = "UnmangleName";
  return DwgDictionaryCloningFlags2;
})(DwgDictionaryCloningFlags || {});
const dwgVersions = [
  {
    type: "invalid",
    hdr: "INVALI",
    description: "No DWG",
    version: 0
  },
  {
    type: "r1.1",
    hdr: "MC0.0",
    description: "MicroCAD Release 1.1",
    version: 0
  },
  {
    type: "r1.2",
    hdr: "AC1.2",
    description: "AutoCAD Release 1.2",
    version: 0
  },
  {
    type: "r1.3",
    hdr: "AC1.3",
    description: "AutoCAD Release 1.3",
    version: 1
  },
  {
    type: "r1.4",
    hdr: "AC1.40",
    description: "AutoCAD Release 1.4",
    version: 2
  },
  { type: "r2.0b", hdr: "AC1.50", description: "AutoCAD 2.0 beta", version: 3 },
  // not seen
  {
    type: "r2.0",
    hdr: "AC1.50",
    description: "AutoCAD Release 2.0",
    version: 4
  },
  {
    type: "r2.10",
    hdr: "AC2.10",
    description: "AutoCAD Release 2.10",
    version: 5
  },
  {
    type: "r2.21",
    hdr: "AC2.21",
    description: "AutoCAD Release 2.21",
    version: 6
  },
  {
    type: "r2.22",
    hdr: "AC2.22",
    description: "AutoCAD Release 2.22",
    version: 7
  },
  {
    type: "r2.4",
    hdr: "AC1001",
    description: "AutoCAD Release 2.4",
    version: 8
  },
  {
    type: "r2.5",
    hdr: "AC1002",
    description: "AutoCAD Release 2.5",
    version: 9
  },
  {
    type: "r2.6",
    hdr: "AC1003",
    description: "AutoCAD Release 2.6",
    version: 10
  },
  { type: "r9", hdr: "AC1004", description: "AutoCAD Release 9", version: 11 },
  {
    type: "r9c1",
    hdr: "AC1005",
    description: "AutoCAD Release 9c1",
    version: 12
  },
  {
    type: "r10",
    hdr: "AC1006",
    description: "AutoCAD Release 10",
    version: 13
  },
  {
    type: "r11b1",
    hdr: "AC1007",
    description: "AutoCAD 11 beta 1",
    version: 14
  },
  {
    type: "r11b2",
    hdr: "AC1008",
    description: "AutoCAD 11 beta 2",
    version: 15
  },
  {
    type: "r11",
    hdr: "AC1009",
    description: "AutoCAD Release 11/12 (LT R1/R2)",
    version: 16
  },
  {
    type: "r13b1",
    hdr: "AC1010",
    description: "AutoCAD pre-R13 a",
    version: 17
  },
  {
    type: "r13b2",
    hdr: "AC1011",
    description: "AutoCAD pre-R13 b",
    version: 18
  },
  {
    type: "r13",
    hdr: "AC1012",
    description: "AutoCAD Release 13",
    version: 19
  },
  {
    type: "r13c3",
    hdr: "AC1013",
    description: "AutoCAD Release 13c3",
    version: 20
  },
  {
    type: "r14",
    hdr: "AC1014",
    description: "AutoCAD Release 14",
    version: 21
  },
  {
    type: "r2000b",
    hdr: "AC1500",
    description: "AutoCAD 2000 beta",
    version: 22
  },
  {
    type: "r2000",
    hdr: "AC1015",
    description: "AutoCAD Release 2000",
    version: 23
  },
  {
    type: "r2000i",
    hdr: "AC1016",
    description: "AutoCAD Release 2000i",
    version: 23
  },
  {
    type: "r2002",
    hdr: "AC1017",
    description: "AutoCAD Release 2002",
    version: 23
  },
  {
    type: "r2004a",
    hdr: "AC402a",
    description: "AutoCAD 2004 alpha a",
    version: 24
  },
  {
    type: "r2004b",
    hdr: "AC402b",
    description: "AutoCAD 2004 alpha b",
    version: 24
  },
  {
    type: "r2004c",
    hdr: "AC1018",
    description: "AutoCAD 2004 beta",
    version: 24
  },
  // (includes versions AC1019/0x19 and AC1020/0x1a)
  {
    type: "r2004",
    hdr: "AC1018",
    description: "AutoCAD Release 2004",
    version: 25
  },
  //{ type: "r2005", hdr: "AC1019", description: "AutoCAD 2005", version: 0x19 }, // not seen
  //{ type: "r2006", hdr: "AC1020", description: "AutoCAD 2006", version: 0x19 }, // not seen
  {
    type: "r2007a",
    hdr: "AC701a",
    description: "AutoCAD 2007 alpha",
    version: 26
  },
  {
    type: "r2007b",
    hdr: "AC1021",
    description: "AutoCAD 2007 beta",
    version: 26
  },
  {
    type: "r2007",
    hdr: "AC1021",
    description: "AutoCAD Release 2007",
    version: 27
  },
  //{ type: "r2008", hdr: "AC1022", description: "AutoCAD 2008", version: 0x1b }, // not seen
  //{ type: "r2009", hdr: "AC1023", description: "AutoCAD 2009", version: 0x1b }, // not seen
  {
    type: "r2010b",
    hdr: "AC1024",
    description: "AutoCAD 2010 beta",
    version: 28
  },
  {
    type: "r2010",
    hdr: "AC1024",
    description: "AutoCAD Release 2010",
    version: 29
  },
  //{ type: "r2011", hdr: "AC1025", description: "AutoCAD 2011", version: 0x1d }, // not seen
  //{ type: "r2012", hdr: "AC1026", description: "AutoCAD 2012", version: 0x1e }, // not seen
  {
    type: "r2013b",
    hdr: "AC1027",
    description: "AutoCAD 2013 beta",
    version: 30
  },
  {
    type: "r2013",
    hdr: "AC1027",
    description: "AutoCAD Release 2013",
    version: 31
  },
  //{ type: "r2014", hdr: "AC1028", description: "AutoCAD 2014", version: 0x1f }, // not seen
  //{ type: "r2015", hdr: "AC1029", description: "AutoCAD 2015", version: 0x1f }, // not seen
  //{ type: "r2016", hdr: "AC1030", description: "AutoCAD 2016", version: 0x1f }, // not seen
  //{ type: "r2017", hdr: "AC1031", description: "AutoCAD 2017", version: 0x20 }, // not seen
  {
    type: "r2018b",
    hdr: "AC1032",
    description: "AutoCAD 2018 beta",
    version: 32
  },
  {
    type: "r2018",
    hdr: "AC1032",
    description: "AutoCAD Release 2018",
    version: 33
  },
  //{ type: "r2019", "AC1033", description: "AutoCAD Release 2019", version: 0x22 }, // not seen
  //{ type: "r2020", "AC1034", description: "AutoCAD Release 2020", version: 0x23 }, // not seen
  //{ type: "r2021", "AC1035", description: "AutoCAD Release 2021", version: 0x23 }, // not seen
  {
    type: "r2022b",
    hdr: "AC103-4",
    description: "AutoCAD 2022 beta",
    version: 36
  },
  { type: "r>2022", hdr: "", description: "AutoCAD Release >2022", version: 0 }
];
var Dwg_Object_Supertype = /* @__PURE__ */ ((Dwg_Object_Supertype2) => {
  Dwg_Object_Supertype2[Dwg_Object_Supertype2["DWG_SUPERTYPE_ENTITY"] = 0] = "DWG_SUPERTYPE_ENTITY";
  Dwg_Object_Supertype2[Dwg_Object_Supertype2["DWG_SUPERTYPE_OBJECT"] = 1] = "DWG_SUPERTYPE_OBJECT";
  return Dwg_Object_Supertype2;
})(Dwg_Object_Supertype || {});
var Dwg_Error = /* @__PURE__ */ ((Dwg_Error2) => {
  Dwg_Error2[Dwg_Error2["WRONGCRC"] = 1] = "WRONGCRC";
  Dwg_Error2[Dwg_Error2["NOTYETSUPPORTED"] = 2] = "NOTYETSUPPORTED";
  Dwg_Error2[Dwg_Error2["UNHANDLEDCLASS"] = 4] = "UNHANDLEDCLASS";
  Dwg_Error2[Dwg_Error2["INVALIDTYPE"] = 8] = "INVALIDTYPE";
  Dwg_Error2[Dwg_Error2["INVALIDHANDLE"] = 16] = "INVALIDHANDLE";
  Dwg_Error2[Dwg_Error2["INVALIDEED"] = 32] = "INVALIDEED";
  Dwg_Error2[Dwg_Error2["VALUEOUTOFBOUNDS"] = 64] = "VALUEOUTOFBOUNDS";
  Dwg_Error2[Dwg_Error2["CLASSESNOTFOUND"] = 128] = "CLASSESNOTFOUND";
  Dwg_Error2[Dwg_Error2["SECTIONNOTFOUND"] = 256] = "SECTIONNOTFOUND";
  Dwg_Error2[Dwg_Error2["PAGENOTFOUND"] = 512] = "PAGENOTFOUND";
  Dwg_Error2[Dwg_Error2["INTERNALERROR"] = 1024] = "INTERNALERROR";
  Dwg_Error2[Dwg_Error2["INVALIDDWG"] = 2048] = "INVALIDDWG";
  Dwg_Error2[Dwg_Error2["IOERROR"] = 4096] = "IOERROR";
  Dwg_Error2[Dwg_Error2["OUTOFMEM"] = 8192] = "OUTOFMEM";
  return Dwg_Error2;
})(Dwg_Error || {});
var Dwg_Object_Type = /* @__PURE__ */ ((Dwg_Object_Type2) => {
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_UNUSED"] = 0] = "DWG_TYPE_UNUSED";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TEXT"] = 1] = "DWG_TYPE_TEXT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ATTRIB"] = 2] = "DWG_TYPE_ATTRIB";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ATTDEF"] = 3] = "DWG_TYPE_ATTDEF";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCK"] = 4] = "DWG_TYPE_BLOCK";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ENDBLK"] = 5] = "DWG_TYPE_ENDBLK";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SEQEND"] = 6] = "DWG_TYPE_SEQEND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_INSERT"] = 7] = "DWG_TYPE_INSERT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MINSERT"] = 8] = "DWG_TYPE_MINSERT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VERTEX_2D"] = 10] = "DWG_TYPE_VERTEX_2D";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VERTEX_3D"] = 11] = "DWG_TYPE_VERTEX_3D";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VERTEX_MESH"] = 12] = "DWG_TYPE_VERTEX_MESH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VERTEX_PFACE"] = 13] = "DWG_TYPE_VERTEX_PFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VERTEX_PFACE_FACE"] = 14] = "DWG_TYPE_VERTEX_PFACE_FACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POLYLINE_2D"] = 15] = "DWG_TYPE_POLYLINE_2D";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POLYLINE_3D"] = 16] = "DWG_TYPE_POLYLINE_3D";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ARC"] = 17] = "DWG_TYPE_ARC";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CIRCLE"] = 18] = "DWG_TYPE_CIRCLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LINE"] = 19] = "DWG_TYPE_LINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_ORDINATE"] = 20] = "DWG_TYPE_DIMENSION_ORDINATE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_LINEAR"] = 21] = "DWG_TYPE_DIMENSION_LINEAR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_ALIGNED"] = 22] = "DWG_TYPE_DIMENSION_ALIGNED";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_ANG3PT"] = 23] = "DWG_TYPE_DIMENSION_ANG3PT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_ANG2LN"] = 24] = "DWG_TYPE_DIMENSION_ANG2LN";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_RADIUS"] = 25] = "DWG_TYPE_DIMENSION_RADIUS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMENSION_DIAMETER"] = 26] = "DWG_TYPE_DIMENSION_DIAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINT"] = 27] = "DWG_TYPE_POINT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_3DFACE"] = 28] = "DWG_TYPE_3DFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POLYLINE_PFACE"] = 29] = "DWG_TYPE_POLYLINE_PFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POLYLINE_MESH"] = 30] = "DWG_TYPE_POLYLINE_MESH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SOLID"] = 31] = "DWG_TYPE_SOLID";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TRACE"] = 32] = "DWG_TYPE_TRACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SHAPE"] = 33] = "DWG_TYPE_SHAPE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VIEWPORT"] = 34] = "DWG_TYPE_VIEWPORT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ELLIPSE"] = 35] = "DWG_TYPE_ELLIPSE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SPLINE"] = 36] = "DWG_TYPE_SPLINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_REGION"] = 37] = "DWG_TYPE_REGION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_3DSOLID"] = 38] = "DWG_TYPE_3DSOLID";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BODY"] = 39] = "DWG_TYPE_BODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RAY"] = 40] = "DWG_TYPE_RAY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_XLINE"] = 41] = "DWG_TYPE_XLINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DICTIONARY"] = 42] = "DWG_TYPE_DICTIONARY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_OLEFRAME"] = 43] = "DWG_TYPE_OLEFRAME";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MTEXT"] = 44] = "DWG_TYPE_MTEXT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LEADER"] = 45] = "DWG_TYPE_LEADER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TOLERANCE"] = 46] = "DWG_TYPE_TOLERANCE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MLINE"] = 47] = "DWG_TYPE_MLINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCK_CONTROL"] = 48] = "DWG_TYPE_BLOCK_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCK_HEADER"] = 49] = "DWG_TYPE_BLOCK_HEADER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYER_CONTROL"] = 50] = "DWG_TYPE_LAYER_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYER"] = 51] = "DWG_TYPE_LAYER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_STYLE_CONTROL"] = 52] = "DWG_TYPE_STYLE_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_STYLE"] = 53] = "DWG_TYPE_STYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LTYPE_CONTROL"] = 56] = "DWG_TYPE_LTYPE_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LTYPE"] = 57] = "DWG_TYPE_LTYPE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VIEW_CONTROL"] = 60] = "DWG_TYPE_VIEW_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VIEW"] = 61] = "DWG_TYPE_VIEW";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_UCS_CONTROL"] = 62] = "DWG_TYPE_UCS_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_UCS"] = 63] = "DWG_TYPE_UCS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VPORT_CONTROL"] = 64] = "DWG_TYPE_VPORT_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VPORT"] = 65] = "DWG_TYPE_VPORT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_APPID_CONTROL"] = 66] = "DWG_TYPE_APPID_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_APPID"] = 67] = "DWG_TYPE_APPID";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMSTYLE_CONTROL"] = 68] = "DWG_TYPE_DIMSTYLE_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMSTYLE"] = 69] = "DWG_TYPE_DIMSTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VX_CONTROL"] = 70] = "DWG_TYPE_VX_CONTROL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VX_TABLE_RECORD"] = 71] = "DWG_TYPE_VX_TABLE_RECORD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GROUP"] = 72] = "DWG_TYPE_GROUP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MLINESTYLE"] = 73] = "DWG_TYPE_MLINESTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_OLE2FRAME"] = 74] = "DWG_TYPE_OLE2FRAME";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DUMMY"] = 75] = "DWG_TYPE_DUMMY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LONG_TRANSACTION"] = 76] = "DWG_TYPE_LONG_TRANSACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LWPOLYLINE"] = 77] = "DWG_TYPE_LWPOLYLINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_HATCH"] = 78] = "DWG_TYPE_HATCH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_XRECORD"] = 79] = "DWG_TYPE_XRECORD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PLACEHOLDER"] = 80] = "DWG_TYPE_PLACEHOLDER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VBA_PROJECT"] = 81] = "DWG_TYPE_VBA_PROJECT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYOUT"] = 82] = "DWG_TYPE_LAYOUT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PROXY_ENTITY"] = 498] = "DWG_TYPE_PROXY_ENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PROXY_OBJECT"] = 499] = "DWG_TYPE_PROXY_OBJECT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACDSRECORD"] = 500] = "DWG_TYPE_ACDSRECORD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACDSSCHEMA"] = 501] = "DWG_TYPE_ACDSSCHEMA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACMECOMMANDHISTORY"] = 502] = "DWG_TYPE_ACMECOMMANDHISTORY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACMESCOPE"] = 503] = "DWG_TYPE_ACMESCOPE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACMESTATEMGR"] = 504] = "DWG_TYPE_ACMESTATEMGR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_BOOLEAN_CLASS"] = 505] = "DWG_TYPE_ACSH_BOOLEAN_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_BOX_CLASS"] = 506] = "DWG_TYPE_ACSH_BOX_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_BREP_CLASS"] = 507] = "DWG_TYPE_ACSH_BREP_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_CHAMFER_CLASS"] = 508] = "DWG_TYPE_ACSH_CHAMFER_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_CONE_CLASS"] = 509] = "DWG_TYPE_ACSH_CONE_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_CYLINDER_CLASS"] = 510] = "DWG_TYPE_ACSH_CYLINDER_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_EXTRUSION_CLASS"] = 511] = "DWG_TYPE_ACSH_EXTRUSION_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_FILLET_CLASS"] = 512] = "DWG_TYPE_ACSH_FILLET_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_HISTORY_CLASS"] = 513] = "DWG_TYPE_ACSH_HISTORY_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_LOFT_CLASS"] = 514] = "DWG_TYPE_ACSH_LOFT_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_PYRAMID_CLASS"] = 515] = "DWG_TYPE_ACSH_PYRAMID_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_REVOLVE_CLASS"] = 516] = "DWG_TYPE_ACSH_REVOLVE_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_SPHERE_CLASS"] = 517] = "DWG_TYPE_ACSH_SPHERE_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_SWEEP_CLASS"] = 518] = "DWG_TYPE_ACSH_SWEEP_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_TORUS_CLASS"] = 519] = "DWG_TYPE_ACSH_TORUS_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ACSH_WEDGE_CLASS"] = 520] = "DWG_TYPE_ACSH_WEDGE_CLASS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ALDIMOBJECTCONTEXTDATA"] = 521] = "DWG_TYPE_ALDIMOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ALIGNMENTPARAMETERENTITY"] = 522] = "DWG_TYPE_ALIGNMENTPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ANGDIMOBJECTCONTEXTDATA"] = 523] = "DWG_TYPE_ANGDIMOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ANNOTSCALEOBJECTCONTEXTDATA"] = 524] = "DWG_TYPE_ANNOTSCALEOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ARCALIGNEDTEXT"] = 525] = "DWG_TYPE_ARCALIGNEDTEXT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ARC_DIMENSION"] = 526] = "DWG_TYPE_ARC_DIMENSION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOC2DCONSTRAINTGROUP"] = 527] = "DWG_TYPE_ASSOC2DCONSTRAINTGROUP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOC3POINTANGULARDIMACTIONBODY"] = 528] = "DWG_TYPE_ASSOC3POINTANGULARDIMACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCACTION"] = 529] = "DWG_TYPE_ASSOCACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCACTIONPARAM"] = 530] = "DWG_TYPE_ASSOCACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCALIGNEDDIMACTIONBODY"] = 531] = "DWG_TYPE_ASSOCALIGNEDDIMACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYACTIONBODY"] = 532] = "DWG_TYPE_ASSOCARRAYACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYMODIFYACTIONBODY"] = 533] = "DWG_TYPE_ASSOCARRAYMODIFYACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYMODIFYPARAMETERS"] = 534] = "DWG_TYPE_ASSOCARRAYMODIFYPARAMETERS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYPATHPARAMETERS"] = 535] = "DWG_TYPE_ASSOCARRAYPATHPARAMETERS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYPOLARPARAMETERS"] = 536] = "DWG_TYPE_ASSOCARRAYPOLARPARAMETERS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCARRAYRECTANGULARPARAMETERS"] = 537] = "DWG_TYPE_ASSOCARRAYRECTANGULARPARAMETERS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCASMBODYACTIONPARAM"] = 538] = "DWG_TYPE_ASSOCASMBODYACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCBLENDSURFACEACTIONBODY"] = 539] = "DWG_TYPE_ASSOCBLENDSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCCOMPOUNDACTIONPARAM"] = 540] = "DWG_TYPE_ASSOCCOMPOUNDACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCDEPENDENCY"] = 541] = "DWG_TYPE_ASSOCDEPENDENCY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCDIMDEPENDENCYBODY"] = 542] = "DWG_TYPE_ASSOCDIMDEPENDENCYBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCEDGEACTIONPARAM"] = 543] = "DWG_TYPE_ASSOCEDGEACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCEDGECHAMFERACTIONBODY"] = 544] = "DWG_TYPE_ASSOCEDGECHAMFERACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCEDGEFILLETACTIONBODY"] = 545] = "DWG_TYPE_ASSOCEDGEFILLETACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCEXTENDSURFACEACTIONBODY"] = 546] = "DWG_TYPE_ASSOCEXTENDSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCEXTRUDEDSURFACEACTIONBODY"] = 547] = "DWG_TYPE_ASSOCEXTRUDEDSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCFACEACTIONPARAM"] = 548] = "DWG_TYPE_ASSOCFACEACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCFILLETSURFACEACTIONBODY"] = 549] = "DWG_TYPE_ASSOCFILLETSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCGEOMDEPENDENCY"] = 550] = "DWG_TYPE_ASSOCGEOMDEPENDENCY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCLOFTEDSURFACEACTIONBODY"] = 551] = "DWG_TYPE_ASSOCLOFTEDSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCMLEADERACTIONBODY"] = 552] = "DWG_TYPE_ASSOCMLEADERACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCNETWORK"] = 553] = "DWG_TYPE_ASSOCNETWORK";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCNETWORKSURFACEACTIONBODY"] = 554] = "DWG_TYPE_ASSOCNETWORKSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCOBJECTACTIONPARAM"] = 555] = "DWG_TYPE_ASSOCOBJECTACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCOFFSETSURFACEACTIONBODY"] = 556] = "DWG_TYPE_ASSOCOFFSETSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCORDINATEDIMACTIONBODY"] = 557] = "DWG_TYPE_ASSOCORDINATEDIMACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCOSNAPPOINTREFACTIONPARAM"] = 558] = "DWG_TYPE_ASSOCOSNAPPOINTREFACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCPATCHSURFACEACTIONBODY"] = 559] = "DWG_TYPE_ASSOCPATCHSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCPATHACTIONPARAM"] = 560] = "DWG_TYPE_ASSOCPATHACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCPERSSUBENTMANAGER"] = 561] = "DWG_TYPE_ASSOCPERSSUBENTMANAGER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCPLANESURFACEACTIONBODY"] = 562] = "DWG_TYPE_ASSOCPLANESURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCPOINTREFACTIONPARAM"] = 563] = "DWG_TYPE_ASSOCPOINTREFACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCRESTOREENTITYSTATEACTIONBODY"] = 564] = "DWG_TYPE_ASSOCRESTOREENTITYSTATEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCREVOLVEDSURFACEACTIONBODY"] = 565] = "DWG_TYPE_ASSOCREVOLVEDSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCROTATEDDIMACTIONBODY"] = 566] = "DWG_TYPE_ASSOCROTATEDDIMACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCSWEPTSURFACEACTIONBODY"] = 567] = "DWG_TYPE_ASSOCSWEPTSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCTRIMSURFACEACTIONBODY"] = 568] = "DWG_TYPE_ASSOCTRIMSURFACEACTIONBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCVALUEDEPENDENCY"] = 569] = "DWG_TYPE_ASSOCVALUEDEPENDENCY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCVARIABLE"] = 570] = "DWG_TYPE_ASSOCVARIABLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ASSOCVERTEXACTIONPARAM"] = 571] = "DWG_TYPE_ASSOCVERTEXACTIONPARAM";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BASEPOINTPARAMETERENTITY"] = 572] = "DWG_TYPE_BASEPOINTPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLKREFOBJECTCONTEXTDATA"] = 573] = "DWG_TYPE_BLKREFOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKALIGNEDCONSTRAINTPARAMETER"] = 574] = "DWG_TYPE_BLOCKALIGNEDCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKALIGNMENTGRIP"] = 575] = "DWG_TYPE_BLOCKALIGNMENTGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKALIGNMENTPARAMETER"] = 576] = "DWG_TYPE_BLOCKALIGNMENTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKANGULARCONSTRAINTPARAMETER"] = 577] = "DWG_TYPE_BLOCKANGULARCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKARRAYACTION"] = 578] = "DWG_TYPE_BLOCKARRAYACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKBASEPOINTPARAMETER"] = 579] = "DWG_TYPE_BLOCKBASEPOINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKDIAMETRICCONSTRAINTPARAMETER"] = 580] = "DWG_TYPE_BLOCKDIAMETRICCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKFLIPACTION"] = 581] = "DWG_TYPE_BLOCKFLIPACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKFLIPGRIP"] = 582] = "DWG_TYPE_BLOCKFLIPGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKFLIPPARAMETER"] = 583] = "DWG_TYPE_BLOCKFLIPPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKGRIPLOCATIONCOMPONENT"] = 584] = "DWG_TYPE_BLOCKGRIPLOCATIONCOMPONENT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKHORIZONTALCONSTRAINTPARAMETER"] = 585] = "DWG_TYPE_BLOCKHORIZONTALCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLINEARCONSTRAINTPARAMETER"] = 586] = "DWG_TYPE_BLOCKLINEARCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLINEARGRIP"] = 587] = "DWG_TYPE_BLOCKLINEARGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLINEARPARAMETER"] = 588] = "DWG_TYPE_BLOCKLINEARPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLOOKUPACTION"] = 589] = "DWG_TYPE_BLOCKLOOKUPACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLOOKUPGRIP"] = 590] = "DWG_TYPE_BLOCKLOOKUPGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKLOOKUPPARAMETER"] = 591] = "DWG_TYPE_BLOCKLOOKUPPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKMOVEACTION"] = 592] = "DWG_TYPE_BLOCKMOVEACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPARAMDEPENDENCYBODY"] = 593] = "DWG_TYPE_BLOCKPARAMDEPENDENCYBODY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPOINTPARAMETER"] = 594] = "DWG_TYPE_BLOCKPOINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPOLARGRIP"] = 595] = "DWG_TYPE_BLOCKPOLARGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPOLARPARAMETER"] = 596] = "DWG_TYPE_BLOCKPOLARPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPOLARSTRETCHACTION"] = 597] = "DWG_TYPE_BLOCKPOLARSTRETCHACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPROPERTIESTABLE"] = 598] = "DWG_TYPE_BLOCKPROPERTIESTABLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKPROPERTIESTABLEGRIP"] = 599] = "DWG_TYPE_BLOCKPROPERTIESTABLEGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKRADIALCONSTRAINTPARAMETER"] = 600] = "DWG_TYPE_BLOCKRADIALCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKREPRESENTATION"] = 601] = "DWG_TYPE_BLOCKREPRESENTATION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKROTATEACTION"] = 602] = "DWG_TYPE_BLOCKROTATEACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKROTATIONGRIP"] = 603] = "DWG_TYPE_BLOCKROTATIONGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKROTATIONPARAMETER"] = 604] = "DWG_TYPE_BLOCKROTATIONPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKSCALEACTION"] = 605] = "DWG_TYPE_BLOCKSCALEACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKSTRETCHACTION"] = 606] = "DWG_TYPE_BLOCKSTRETCHACTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKUSERPARAMETER"] = 607] = "DWG_TYPE_BLOCKUSERPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKVERTICALCONSTRAINTPARAMETER"] = 608] = "DWG_TYPE_BLOCKVERTICALCONSTRAINTPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKVISIBILITYGRIP"] = 609] = "DWG_TYPE_BLOCKVISIBILITYGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKVISIBILITYPARAMETER"] = 610] = "DWG_TYPE_BLOCKVISIBILITYPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKXYGRIP"] = 611] = "DWG_TYPE_BLOCKXYGRIP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BLOCKXYPARAMETER"] = 612] = "DWG_TYPE_BLOCKXYPARAMETER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CAMERA"] = 613] = "DWG_TYPE_CAMERA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CELLSTYLEMAP"] = 614] = "DWG_TYPE_CELLSTYLEMAP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CONTEXTDATAMANAGER"] = 615] = "DWG_TYPE_CONTEXTDATAMANAGER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CSACDOCUMENTOPTIONS"] = 616] = "DWG_TYPE_CSACDOCUMENTOPTIONS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_CURVEPATH"] = 617] = "DWG_TYPE_CURVEPATH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DATALINK"] = 618] = "DWG_TYPE_DATALINK";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DATATABLE"] = 619] = "DWG_TYPE_DATATABLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DBCOLOR"] = 620] = "DWG_TYPE_DBCOLOR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DETAILVIEWSTYLE"] = 621] = "DWG_TYPE_DETAILVIEWSTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DGNDEFINITION"] = 622] = "DWG_TYPE_DGNDEFINITION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DGNUNDERLAY"] = 623] = "DWG_TYPE_DGNUNDERLAY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DICTIONARYVAR"] = 624] = "DWG_TYPE_DICTIONARYVAR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DICTIONARYWDFLT"] = 625] = "DWG_TYPE_DICTIONARYWDFLT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DIMASSOC"] = 626] = "DWG_TYPE_DIMASSOC";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DMDIMOBJECTCONTEXTDATA"] = 627] = "DWG_TYPE_DMDIMOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DWFDEFINITION"] = 628] = "DWG_TYPE_DWFDEFINITION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DWFUNDERLAY"] = 629] = "DWG_TYPE_DWFUNDERLAY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DYNAMICBLOCKPROXYNODE"] = 630] = "DWG_TYPE_DYNAMICBLOCKPROXYNODE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_DYNAMICBLOCKPURGEPREVENTER"] = 631] = "DWG_TYPE_DYNAMICBLOCKPURGEPREVENTER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_EVALUATION_GRAPH"] = 632] = "DWG_TYPE_EVALUATION_GRAPH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_EXTRUDEDSURFACE"] = 633] = "DWG_TYPE_EXTRUDEDSURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FCFOBJECTCONTEXTDATA"] = 634] = "DWG_TYPE_FCFOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FIELD"] = 635] = "DWG_TYPE_FIELD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FIELDLIST"] = 636] = "DWG_TYPE_FIELDLIST";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FLIPPARAMETERENTITY"] = 637] = "DWG_TYPE_FLIPPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FLIPACTIONENTITY"] = 638] = "DWG_TYPE_FLIPACTIONENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GEODATA"] = 639] = "DWG_TYPE_GEODATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GEOMAPIMAGE"] = 640] = "DWG_TYPE_GEOMAPIMAGE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GEOPOSITIONMARKER"] = 641] = "DWG_TYPE_GEOPOSITIONMARKER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GRADIENT_BACKGROUND"] = 642] = "DWG_TYPE_GRADIENT_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_GROUND_PLANE_BACKGROUND"] = 643] = "DWG_TYPE_GROUND_PLANE_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_HELIX"] = 644] = "DWG_TYPE_HELIX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IBL_BACKGROUND"] = 645] = "DWG_TYPE_IBL_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IDBUFFER"] = 646] = "DWG_TYPE_IDBUFFER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IMAGE"] = 647] = "DWG_TYPE_IMAGE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IMAGEDEF"] = 648] = "DWG_TYPE_IMAGEDEF";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IMAGEDEF_REACTOR"] = 649] = "DWG_TYPE_IMAGEDEF_REACTOR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_IMAGE_BACKGROUND"] = 650] = "DWG_TYPE_IMAGE_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_INDEX"] = 651] = "DWG_TYPE_INDEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LARGE_RADIAL_DIMENSION"] = 652] = "DWG_TYPE_LARGE_RADIAL_DIMENSION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYERFILTER"] = 653] = "DWG_TYPE_LAYERFILTER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYER_INDEX"] = 654] = "DWG_TYPE_LAYER_INDEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LAYOUTPRINTCONFIG"] = 655] = "DWG_TYPE_LAYOUTPRINTCONFIG";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LEADEROBJECTCONTEXTDATA"] = 656] = "DWG_TYPE_LEADEROBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LIGHT"] = 657] = "DWG_TYPE_LIGHT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LIGHTLIST"] = 658] = "DWG_TYPE_LIGHTLIST";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LINEARPARAMETERENTITY"] = 659] = "DWG_TYPE_LINEARPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LOFTEDSURFACE"] = 660] = "DWG_TYPE_LOFTEDSURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MATERIAL"] = 661] = "DWG_TYPE_MATERIAL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MENTALRAYRENDERSETTINGS"] = 662] = "DWG_TYPE_MENTALRAYRENDERSETTINGS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MESH"] = 663] = "DWG_TYPE_MESH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MLEADEROBJECTCONTEXTDATA"] = 664] = "DWG_TYPE_MLEADEROBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MLEADERSTYLE"] = 665] = "DWG_TYPE_MLEADERSTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MOVEACTIONENTITY"] = 666] = "DWG_TYPE_MOVEACTIONENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MOTIONPATH"] = 667] = "DWG_TYPE_MOTIONPATH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MPOLYGON"] = 668] = "DWG_TYPE_MPOLYGON";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MTEXTATTRIBUTEOBJECTCONTEXTDATA"] = 669] = "DWG_TYPE_MTEXTATTRIBUTEOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MTEXTOBJECTCONTEXTDATA"] = 670] = "DWG_TYPE_MTEXTOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_MULTILEADER"] = 671] = "DWG_TYPE_MULTILEADER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_NAVISWORKSMODEL"] = 672] = "DWG_TYPE_NAVISWORKSMODEL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_NAVISWORKSMODELDEF"] = 673] = "DWG_TYPE_NAVISWORKSMODELDEF";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_NPOCOLLECTION"] = 674] = "DWG_TYPE_NPOCOLLECTION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_NURBSURFACE"] = 675] = "DWG_TYPE_NURBSURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_OBJECT_PTR"] = 676] = "DWG_TYPE_OBJECT_PTR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ORDDIMOBJECTCONTEXTDATA"] = 677] = "DWG_TYPE_ORDDIMOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PARTIAL_VIEWING_INDEX"] = 678] = "DWG_TYPE_PARTIAL_VIEWING_INDEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PDFDEFINITION"] = 679] = "DWG_TYPE_PDFDEFINITION";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PDFUNDERLAY"] = 680] = "DWG_TYPE_PDFUNDERLAY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PERSUBENTMGR"] = 681] = "DWG_TYPE_PERSUBENTMGR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PLANESURFACE"] = 682] = "DWG_TYPE_PLANESURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_PLOTSETTINGS"] = 683] = "DWG_TYPE_PLOTSETTINGS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUD"] = 684] = "DWG_TYPE_POINTCLOUD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDCOLORMAP"] = 685] = "DWG_TYPE_POINTCLOUDCOLORMAP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDDEF"] = 686] = "DWG_TYPE_POINTCLOUDDEF";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDDEFEX"] = 687] = "DWG_TYPE_POINTCLOUDDEFEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDDEF_REACTOR"] = 688] = "DWG_TYPE_POINTCLOUDDEF_REACTOR";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDDEF_REACTOR_EX"] = 689] = "DWG_TYPE_POINTCLOUDDEF_REACTOR_EX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTCLOUDEX"] = 690] = "DWG_TYPE_POINTCLOUDEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTPARAMETERENTITY"] = 691] = "DWG_TYPE_POINTPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POINTPATH"] = 692] = "DWG_TYPE_POINTPATH";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_POLARGRIPENTITY"] = 693] = "DWG_TYPE_POLARGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RADIMLGOBJECTCONTEXTDATA"] = 694] = "DWG_TYPE_RADIMLGOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RADIMOBJECTCONTEXTDATA"] = 695] = "DWG_TYPE_RADIMOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RAPIDRTRENDERSETTINGS"] = 696] = "DWG_TYPE_RAPIDRTRENDERSETTINGS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RASTERVARIABLES"] = 697] = "DWG_TYPE_RASTERVARIABLES";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RENDERENTRY"] = 698] = "DWG_TYPE_RENDERENTRY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RENDERENVIRONMENT"] = 699] = "DWG_TYPE_RENDERENVIRONMENT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RENDERGLOBAL"] = 700] = "DWG_TYPE_RENDERGLOBAL";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RENDERSETTINGS"] = 701] = "DWG_TYPE_RENDERSETTINGS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_REVOLVEDSURFACE"] = 702] = "DWG_TYPE_REVOLVEDSURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ROTATIONPARAMETERENTITY"] = 703] = "DWG_TYPE_ROTATIONPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ROTATEACTIONENTITY"] = 704] = "DWG_TYPE_ROTATEACTIONENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_RTEXT"] = 705] = "DWG_TYPE_RTEXT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SCALE"] = 706] = "DWG_TYPE_SCALE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SCALEACTIONENTITY"] = 707] = "DWG_TYPE_SCALEACTIONENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SECTIONOBJECT"] = 708] = "DWG_TYPE_SECTIONOBJECT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SECTIONVIEWSTYLE"] = 709] = "DWG_TYPE_SECTIONVIEWSTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SECTION_MANAGER"] = 710] = "DWG_TYPE_SECTION_MANAGER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SECTION_SETTINGS"] = 711] = "DWG_TYPE_SECTION_SETTINGS";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SKYLIGHT_BACKGROUND"] = 712] = "DWG_TYPE_SKYLIGHT_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SOLID_BACKGROUND"] = 713] = "DWG_TYPE_SOLID_BACKGROUND";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SORTENTSTABLE"] = 714] = "DWG_TYPE_SORTENTSTABLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SPATIAL_FILTER"] = 715] = "DWG_TYPE_SPATIAL_FILTER";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SPATIAL_INDEX"] = 716] = "DWG_TYPE_SPATIAL_INDEX";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_STRETCHACTIONENTITY"] = 717] = "DWG_TYPE_STRETCHACTIONENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SUN"] = 718] = "DWG_TYPE_SUN";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SUNSTUDY"] = 719] = "DWG_TYPE_SUNSTUDY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_SWEPTSURFACE"] = 720] = "DWG_TYPE_SWEPTSURFACE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TABLE"] = 721] = "DWG_TYPE_TABLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TABLECONTENT"] = 722] = "DWG_TYPE_TABLECONTENT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TABLEGEOMETRY"] = 723] = "DWG_TYPE_TABLEGEOMETRY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TABLESTYLE"] = 724] = "DWG_TYPE_TABLESTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TEXTOBJECTCONTEXTDATA"] = 725] = "DWG_TYPE_TEXTOBJECTCONTEXTDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_TVDEVICEPROPERTIES"] = 726] = "DWG_TYPE_TVDEVICEPROPERTIES";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VISIBILITYGRIPENTITY"] = 727] = "DWG_TYPE_VISIBILITYGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VISIBILITYPARAMETERENTITY"] = 728] = "DWG_TYPE_VISIBILITYPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_VISUALSTYLE"] = 729] = "DWG_TYPE_VISUALSTYLE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_WIPEOUT"] = 730] = "DWG_TYPE_WIPEOUT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_WIPEOUTVARIABLES"] = 731] = "DWG_TYPE_WIPEOUTVARIABLES";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_XREFPANELOBJECT"] = 732] = "DWG_TYPE_XREFPANELOBJECT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_XYPARAMETERENTITY"] = 733] = "DWG_TYPE_XYPARAMETERENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BREAKDATA"] = 734] = "DWG_TYPE_BREAKDATA";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_BREAKPOINTREF"] = 735] = "DWG_TYPE_BREAKPOINTREF";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FLIPGRIPENTITY"] = 736] = "DWG_TYPE_FLIPGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LINEARGRIPENTITY"] = 737] = "DWG_TYPE_LINEARGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ROTATIONGRIPENTITY"] = 738] = "DWG_TYPE_ROTATIONGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_XYGRIPENTITY"] = 739] = "DWG_TYPE_XYGRIPENTITY";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE__3DLINE"] = 740] = "DWG_TYPE__3DLINE";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_REPEAT"] = 741] = "DWG_TYPE_REPEAT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_ENDREP"] = 742] = "DWG_TYPE_ENDREP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_JUMP"] = 743] = "DWG_TYPE_JUMP";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_LOAD"] = 744] = "DWG_TYPE_LOAD";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_FREED"] = 65533] = "DWG_TYPE_FREED";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_UNKNOWN_ENT"] = 65534] = "DWG_TYPE_UNKNOWN_ENT";
  Dwg_Object_Type2[Dwg_Object_Type2["DWG_TYPE_UNKNOWN_OBJ"] = 65535] = "DWG_TYPE_UNKNOWN_OBJ";
  return Dwg_Object_Type2;
})(Dwg_Object_Type || {});
const Dwg_Object_Type_Inverted = Object.fromEntries(
  Object.entries(Dwg_Object_Type).map(([key, value]) => [value, key])
);
var Dwg_File_Type = /* @__PURE__ */ ((Dwg_File_Type2) => {
  Dwg_File_Type2[Dwg_File_Type2["DWG"] = 0] = "DWG";
  Dwg_File_Type2[Dwg_File_Type2["DXF"] = 1] = "DXF";
  return Dwg_File_Type2;
})(Dwg_File_Type || {});
var Dwg_Hatch_Edge_Type = /* @__PURE__ */ ((Dwg_Hatch_Edge_Type2) => {
  Dwg_Hatch_Edge_Type2[Dwg_Hatch_Edge_Type2["Line"] = 1] = "Line";
  Dwg_Hatch_Edge_Type2[Dwg_Hatch_Edge_Type2["CircularArc"] = 2] = "CircularArc";
  Dwg_Hatch_Edge_Type2[Dwg_Hatch_Edge_Type2["EllipticArc"] = 3] = "EllipticArc";
  Dwg_Hatch_Edge_Type2[Dwg_Hatch_Edge_Type2["Spline"] = 4] = "Spline";
  return Dwg_Hatch_Edge_Type2;
})(Dwg_Hatch_Edge_Type || {});
var Dwg_Color_Method = /* @__PURE__ */ ((Dwg_Color_Method2) => {
  Dwg_Color_Method2[Dwg_Color_Method2["ByLayer"] = 192] = "ByLayer";
  Dwg_Color_Method2[Dwg_Color_Method2["ByBlock"] = 193] = "ByBlock";
  Dwg_Color_Method2[Dwg_Color_Method2["Entities"] = 194] = "Entities";
  Dwg_Color_Method2[Dwg_Color_Method2["TrueColor"] = 195] = "TrueColor";
  Dwg_Color_Method2[Dwg_Color_Method2["ForegroundColor"] = 197] = "ForegroundColor";
  Dwg_Color_Method2[Dwg_Color_Method2["None"] = 200] = "None";
  return Dwg_Color_Method2;
})(Dwg_Color_Method || {});
const MODEL_SPACE = "*MODEL_SPACE";
const MODEL_SPACE_PREFIX = "*PAPER_SPACE";
const isModelSpace = (name) => {
  return name && name.toUpperCase() == MODEL_SPACE;
};
const isPaperSpace = (name) => {
  return name && name.toUpperCase().startsWith(MODEL_SPACE_PREFIX);
};
const idToString = (id) => {
  return id.toString(16).toUpperCase();
};
const uint8ArrayToHexString = (bytes) => {
  const hexChars = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hexChars[i] = bytes[i].toString(16).toUpperCase().padStart(2, "0");
  }
  return hexChars.join("");
};
class LibreEntityConverter {
  constructor(instance) {
    __publicField(this, "libredwg");
    __publicField(this, "layers", /* @__PURE__ */ new Map());
    __publicField(this, "ltypes", /* @__PURE__ */ new Map());
    __publicField(this, "classes", []);
    __publicField(this, "unknownEntityCount");
    this.libredwg = instance;
    this.unknownEntityCount = 0;
  }
  prepare(db, force = false) {
    if (force || this.layers.size == 0) {
      this.layers.clear();
      db.tables.LAYER.entries.forEach((layer) => {
        this.layers.set(layer.handle, layer.name);
      });
    }
    if (force || this.ltypes.size == 0) {
      this.ltypes.clear();
      db.tables.LTYPE.entries.forEach((ltype) => {
        this.ltypes.set(ltype.handle, ltype.name);
      });
    }
    this.classes = db.classes;
    this.unknownEntityCount = 0;
  }
  setClasses(classes) {
    this.classes = classes;
  }
  clear() {
    this.layers.clear();
    this.ltypes.clear();
    this.classes = [];
    this.unknownEntityCount = 0;
  }
  convert(object_ptr) {
    const libredwg = this.libredwg;
    const entity = libredwg.dwg_object_to_entity(object_ptr);
    const entity_tio = libredwg.dwg_object_to_entity_tio(object_ptr);
    if (entity && entity_tio) {
      const commonAttrs = this.getCommonAttrs(entity);
      const fixedtype = libredwg.dwg_object_get_fixedtype(object_ptr);
      if (fixedtype == Dwg_Object_Type.DWG_TYPE_3DFACE) {
        return this.convert3dFace(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_ARC) {
        return this.convertArc(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_ATTDEF) {
        return this.convertAttdef(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_CIRCLE) {
        return this.convertCircle(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_ALIGNED || fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_LINEAR) {
        return this.convertAlignedDimension(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_ANG3PT) {
        return this.convert3PointAngularDimension(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_DIAMETER) {
        return this.convertDiameterDimension(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_ORDINATE) {
        return this.convertOrdinateDimension(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_DIMENSION_RADIUS) {
        return this.convertRadiusDimension(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_ELLIPSE) {
        return this.convertEllise(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_HATCH) {
        return this.convertHatch(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_IMAGE) {
        return this.convertImage(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_INSERT) {
        return this.convertInsert(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_LEADER) {
        return this.convertLeader(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_LINE) {
        return this.convertLine(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_LWPOLYLINE) {
        return this.convertLWPolyline(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_MLINE) {
        return this.convertMLine(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_MTEXT) {
        return this.convertMText(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_OLE2FRAME) {
        return this.convertOle2Frame(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_OLEFRAME) {
        return this.convertOleFrame(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_POINT) {
        return this.convertPoint(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_POLYLINE_2D) {
        return this.convertPolyline2d(entity_tio, commonAttrs, object_ptr);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_POLYLINE_3D) {
        return this.convertPolyline3d(entity_tio, commonAttrs, object_ptr);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_PROXY_ENTITY) {
        return this.convertProxyEntity(entity_tio, commonAttrs, object_ptr);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_RAY) {
        return this.convertRay(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_SECTIONOBJECT) {
        return this.convertSection(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_SOLID) {
        return this.convertSolid(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_SPLINE) {
        return this.convertSpline(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_TABLE) {
        return this.convertTable(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_TEXT) {
        return this.convertText(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_TOLERANCE) {
        return this.convertTolerance(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_VIEWPORT) {
        return this.convertViewport(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_WIPEOUT) {
        return this.convertWipeout(entity_tio, commonAttrs);
      } else if (fixedtype == Dwg_Object_Type.DWG_TYPE_XLINE) {
        return this.convertXline(entity_tio, commonAttrs);
      } else if (fixedtype === Dwg_Object_Type.DWG_TYPE_UNKNOWN_ENT) {
        this.unknownEntityCount++;
      }
    }
    return void 0;
  }
  convert3dFace(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const corner1 = libredwg.dwg_dynapi_entity_value(entity, "corner1").data;
    const corner2 = libredwg.dwg_dynapi_entity_value(entity, "corner2").data;
    const corner3 = libredwg.dwg_dynapi_entity_value(entity, "corner3").data;
    const corner4 = libredwg.dwg_dynapi_entity_value(entity, "corner4").data;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "invis_flags").data;
    return {
      type: "3DFACE",
      ...commonAttrs,
      corner1,
      corner2,
      corner3,
      corner4,
      flag
    };
  }
  convertArc(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const center = libredwg.dwg_dynapi_entity_value(entity, "center").data;
    const radius = libredwg.dwg_dynapi_entity_value(entity, "radius").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const startAngle = libredwg.dwg_dynapi_entity_value(entity, "start_angle").data;
    const endAngle = libredwg.dwg_dynapi_entity_value(entity, "end_angle").data;
    return {
      type: "ARC",
      ...commonAttrs,
      thickness,
      center,
      radius,
      startAngle,
      endAngle,
      extrusionDirection
    };
  }
  convertEmbeddedMText(entity, subclassName) {
    const libredwg = this.libredwg;
    const attachmentPoint = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "attachment"
    ).data;
    const insertionPoint = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "ins_pt"
    ).data;
    const direction = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "x_axis_dir"
    ).data;
    const rectHeight = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "rect_height"
    ).data;
    const rectWidth = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "rect_width"
    ).data;
    const extentsHeight = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "extents_height"
    ).data;
    const extentsWidth = libredwg.dwg_dynapi_subclass_value(
      entity,
      subclassName,
      "extents_width"
    ).data;
    return {
      insertionPoint,
      rectHeight,
      rectWidth,
      extentsHeight,
      extentsWidth,
      attachmentPoint,
      direction
      // columnType: columnType,
      // columnFlowReversed: columnFlowReversed,
      // columnAutoHeight: columnAutoHeight,
      // columnWidth: columnWidth,
      // columnGutter: columnGutter,
      // columnHeightCount: columnHeightCount,
      // columnHeights: columnHeights
    };
  }
  convertAttdef(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const textValue = libredwg.dwg_dynapi_entity_value(entity, "default_value").data;
    const text = this.convertTextBase(entity);
    text.text = textValue;
    const prompt = libredwg.dwg_dynapi_entity_value(entity, "prompt").data;
    const tag = libredwg.dwg_dynapi_entity_value(entity, "tag").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "flags").data;
    const fieldLength = libredwg.dwg_dynapi_entity_value(entity, "field_length").data;
    const lockPositionFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "lock_position_flag"
    ).data;
    const duplicateRecordCloningFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "keep_duplicate_records"
    ).data;
    const isReallyLocked = libredwg.dwg_dynapi_entity_value(
      entity,
      "is_really_locked"
    ).data;
    const mtextFlag = libredwg.dwg_dynapi_entity_value(entity, "mtext_type").data;
    const alignmentPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "alignment_pt"
    ).data;
    return {
      type: "ATTDEF",
      ...commonAttrs,
      text: this.convertTextBase(entity),
      prompt,
      tag,
      flags,
      fieldLength,
      lockPositionFlag: lockPositionFlag > 0,
      duplicateRecordCloningFlag: duplicateRecordCloningFlag > 0,
      mtextFlag,
      isReallyLocked: isReallyLocked > 0,
      alignmentPoint,
      annotationScale: 1,
      // TODO: Set the correct value
      attrTag: "",
      // TODO: Set the correct value
      mtext: this.convertEmbeddedMText(entity, "ATTDEF_mtext")
    };
  }
  convertAttrib(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const text = this.convertTextBase(entity);
    const tag = libredwg.dwg_dynapi_entity_value(entity, "tag").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "flags").data;
    const fieldLength = libredwg.dwg_dynapi_entity_value(entity, "field_length").data;
    const lockPositionFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "lock_position_flag"
    ).data;
    const duplicateRecordCloningFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "keep_duplicate_records"
    ).data;
    const mtextFlag = libredwg.dwg_dynapi_entity_value(entity, "mtext_type").data;
    const isReallyLocked = libredwg.dwg_dynapi_entity_value(
      entity,
      "is_really_locked"
    ).data;
    const alignmentPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "alignment_pt"
    ).data;
    return {
      type: "ATTRIB",
      ...commonAttrs,
      text,
      tag,
      flags,
      fieldLength,
      lockPositionFlag: !!lockPositionFlag,
      duplicateRecordCloningFlag: !!duplicateRecordCloningFlag,
      mtextFlag,
      isReallyLocked: !!isReallyLocked,
      numberOfSecondaryAttrs: 0,
      // TODO: libredwg doesn't support it yet.
      secondaryAttrsHardId: "0",
      // TODO: libredwg doesn't support it yet.
      alignmentPoint: { ...alignmentPoint, z: 0 },
      annotationScale: 1,
      // TODO: Set the correct value
      attrTag: "",
      // TODO: Set the correct value
      mtext: this.convertEmbeddedMText(entity, "ATTDEF_mtext")
    };
  }
  convertCircle(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const center = libredwg.dwg_dynapi_entity_value(entity, "center").data;
    const radius = libredwg.dwg_dynapi_entity_value(entity, "radius").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    return {
      type: "CIRCLE",
      ...commonAttrs,
      thickness,
      center,
      radius,
      extrusionDirection
    };
  }
  convertAlignedDimension(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const dimensionCommonAttrs = this.getDimensionCommonAttrs(entity);
    const insertionPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "clone_ins_pt"
    ).data;
    const subDefinitionPoint1 = libredwg.dwg_dynapi_entity_value(
      entity,
      "xline1_pt"
    ).data;
    const subDefinitionPoint2 = libredwg.dwg_dynapi_entity_value(
      entity,
      "xline2_pt"
    ).data;
    const rotationAngle = libredwg.dwg_dynapi_entity_value(
      entity,
      "ins_rotation"
    ).data;
    const obliqueAngle = libredwg.dwg_dynapi_entity_value(
      entity,
      "oblique_angle"
    ).data;
    return {
      subclassMarker: "AcDbAlignedDimension",
      ...commonAttrs,
      ...dimensionCommonAttrs,
      insertionPoint,
      subDefinitionPoint1,
      subDefinitionPoint2,
      rotationAngle: rotationAngle == null ? 0 : rotationAngle,
      obliqueAngle
    };
  }
  convert3PointAngularDimension(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const dimensionCommonAttrs = this.getDimensionCommonAttrs(entity);
    const subDefinitionPoint1 = libredwg.dwg_dynapi_entity_value(
      entity,
      "xline1_pt"
    ).data;
    const subDefinitionPoint2 = libredwg.dwg_dynapi_entity_value(
      entity,
      "xline2_pt"
    ).data;
    const centerPoint = libredwg.dwg_dynapi_entity_value(entity, "center_pt").data;
    const arcPoint = libredwg.dwg_dynapi_entity_value(entity, "xline2end_pt").data;
    return {
      subclassMarker: "AcDb3PointAngularDimension",
      ...commonAttrs,
      ...dimensionCommonAttrs,
      subDefinitionPoint1,
      subDefinitionPoint2,
      centerPoint,
      arcPoint
    };
  }
  convertDiameterDimension(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const dimensionCommonAttrs = this.getDimensionCommonAttrs(entity);
    const centerPoint = libredwg.dwg_dynapi_entity_value(entity, "first_arc_pt").data;
    const leaderLength = libredwg.dwg_dynapi_entity_value(entity, "leader_len").data;
    return {
      subclassMarker: "AcDbDiametricDimension",
      ...commonAttrs,
      ...dimensionCommonAttrs,
      centerPoint,
      leaderLength
    };
  }
  convertOrdinateDimension(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const dimensionCommonAttrs = this.getDimensionCommonAttrs(entity);
    const subDefinitionPoint1 = libredwg.dwg_dynapi_entity_value(
      entity,
      "feature_location_pt"
    ).data;
    const subDefinitionPoint2 = libredwg.dwg_dynapi_entity_value(
      entity,
      "leader_endpt"
    ).data;
    return {
      subclassMarker: "AcDbOrdinateDimension",
      ...commonAttrs,
      ...dimensionCommonAttrs,
      subDefinitionPoint1,
      subDefinitionPoint2
    };
  }
  convertRadiusDimension(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const dimensionCommonAttrs = this.getDimensionCommonAttrs(entity);
    const centerPoint = libredwg.dwg_dynapi_entity_value(entity, "first_arc_pt").data;
    const leaderLength = libredwg.dwg_dynapi_entity_value(entity, "leader_len").data;
    return {
      subclassMarker: "AcDbRadialDimension",
      ...commonAttrs,
      ...dimensionCommonAttrs,
      centerPoint,
      leaderLength
    };
  }
  convertEllise(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const center = libredwg.dwg_dynapi_entity_value(entity, "center").data;
    const majorAxisEndPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "sm_axis"
    ).data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const axisRatio = libredwg.dwg_dynapi_entity_value(entity, "axis_ratio").data;
    const startAngle = libredwg.dwg_dynapi_entity_value(entity, "start_angle").data;
    const endAngle = libredwg.dwg_dynapi_entity_value(entity, "end_angle").data;
    return {
      type: "ELLIPSE",
      ...commonAttrs,
      center,
      majorAxisEndPoint,
      extrusionDirection,
      axisRatio,
      startAngle,
      endAngle
    };
  }
  convertHatch(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const patternName = libredwg.dwg_dynapi_entity_value(entity, "name").data;
    const isSolidFill = libredwg.dwg_dynapi_entity_value(
      entity,
      "is_solid_fill"
    ).data;
    const isAssociative = libredwg.dwg_dynapi_entity_value(
      entity,
      "is_associative"
    ).data;
    const numberOfBoundaryPaths = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_paths"
    ).data;
    const paths_ptr = libredwg.dwg_dynapi_entity_value(entity, "paths").data;
    const boundaryPaths = libredwg.dwg_ptr_to_hatch_path_array(
      paths_ptr,
      numberOfBoundaryPaths
    );
    const patternStyle = libredwg.dwg_dynapi_entity_value(entity, "style").data;
    const patternType = libredwg.dwg_dynapi_entity_value(entity, "pattern_type").data;
    const patternAngle = libredwg.dwg_dynapi_entity_value(entity, "angle").data;
    const patternScale = libredwg.dwg_dynapi_entity_value(
      entity,
      "scale_spacing"
    ).data;
    const numberOfDefinitionLines = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_deflines"
    ).data;
    const definitionLines_ptr = libredwg.dwg_dynapi_entity_value(
      entity,
      "deflines"
    ).data;
    const definitionLines = libredwg.dwg_ptr_to_hatch_defline_array(
      definitionLines_ptr,
      numberOfDefinitionLines
    );
    const pixelSize = libredwg.dwg_dynapi_entity_value(entity, "pixel_size").data;
    const numberOfSeedPoints = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_seeds"
    ).data;
    const seedPoints_ptr = libredwg.dwg_dynapi_entity_value(entity, "seeds").data;
    const seedPoints = libredwg.dwg_ptr_to_point2d_array(
      seedPoints_ptr,
      numberOfSeedPoints
    );
    const result = {
      ...commonAttrs,
      // elevationPoint: DwgPoint3D
      extrusionDirection,
      patternName,
      solidFill: isSolidFill ? DwgHatchSolidFill.SolidFill : DwgHatchSolidFill.PatternFill,
      // patternFillColor: number
      associativity: isAssociative ? DwgHatchAssociativity.Associative : DwgHatchAssociativity.NonAssociative,
      numberOfBoundaryPaths,
      boundaryPaths: this.convertHatchBoundaryPaths(boundaryPaths),
      hatchStyle: patternStyle,
      patternType,
      patternAngle,
      patternScale,
      numberOfDefinitionLines,
      definitionLines: definitionLines.map((value) => {
        return {
          angle: value.angle,
          base: value.pt0,
          offset: value.offset,
          numberOfDashLengths: value.dashes.length,
          dashLengths: value.dashes
        };
      }),
      pixelSize,
      numberOfSeedPoints,
      // offsetVector?: DwgPoint3D
      seedPoints
      // gradientFlag?: DwgHatchGradientFlag
    };
    const gradientFlag = libredwg.dwg_dynapi_entity_value(entity, "is_gradient_fill").data;
    if (gradientFlag > 0) {
      const gradientName = libredwg.dwg_dynapi_entity_value(entity, "gradient_name").data;
      const gradientRotation = libredwg.dwg_dynapi_entity_value(entity, "gradient_angle").data;
      const gradientDefinition = libredwg.dwg_dynapi_entity_value(entity, "gradient_shift").data;
      const colorTint = libredwg.dwg_dynapi_entity_value(entity, "gradient_tint").data;
      const gradientColorFlag = libredwg.dwg_dynapi_entity_value(entity, "single_color_gradient").data;
      const gradientColors_ptr = libredwg.dwg_dynapi_entity_value(entity, "colors").data;
      const gradientColors = libredwg.dwg_ptr_to_hatch_gradient_color_array(gradientColors_ptr, gradientColorFlag == 1 ? 1 : 2);
      return {
        type: "HATCH",
        ...result,
        gradientFlag: DwgHatchGradientFlag.Gradient,
        gradientColorFlag: gradientColorFlag == 1 ? DwgHatchGradientColorFlag.OneColor : DwgHatchGradientColorFlag.TwoColor,
        gradientName,
        gradientRotation,
        gradientDefinition,
        colorTint,
        gradientColors
      };
    } else {
      return {
        type: "HATCH",
        ...result
      };
    }
  }
  convertHatchBoundaryPaths(paths) {
    const converted = paths.filter((path) => path.num_segs_or_paths > 0).map((path) => {
      const commonAttrs = {
        boundaryPathTypeFlag: path.flag
      };
      if (path.flag & 2) {
        return {
          ...commonAttrs,
          hasBulge: path.bulges_present,
          isClosed: path.closed,
          numberOfVertices: path.num_segs_or_paths,
          vertices: path.polyline_paths.map((vertex) => {
            return {
              x: vertex.point.x,
              y: vertex.point.y,
              bulge: vertex.bulge
            };
          })
        };
      } else {
        const edges = path.segs.map((seg) => {
          if (seg.curve_type == Dwg_Hatch_Edge_Type.Line) {
            return {
              type: DwgBoundaryPathEdgeType.Line,
              start: seg.first_endpoint,
              end: seg.second_endpoint
            };
          } else if (seg.curve_type == Dwg_Hatch_Edge_Type.CircularArc) {
            return {
              type: DwgBoundaryPathEdgeType.Circular,
              center: seg.center,
              radius: seg.radius,
              startAngle: seg.start_angle,
              endAngle: seg.end_angle,
              isCCW: seg.is_ccw
            };
          } else if (seg.curve_type == Dwg_Hatch_Edge_Type.EllipticArc) {
            return {
              type: DwgBoundaryPathEdgeType.Elliptic,
              center: seg.center,
              end: seg.endpoint,
              lengthOfMinorAxis: seg.minor_major_ratio,
              startAngle: seg.start_angle,
              endAngle: seg.end_angle,
              isCCW: seg.is_ccw
            };
          } else if (seg.curve_type == Dwg_Hatch_Edge_Type.Spline) {
            return {
              type: DwgBoundaryPathEdgeType.Spline,
              degree: seg.degree,
              isRational: seg.is_rational,
              isPeriodic: seg.is_periodic,
              numberOfKnots: seg.num_knots,
              numberOfControlPoints: seg.num_control_points,
              knots: seg.knots,
              controlPoints: seg.control_points,
              numberOfFitData: seg.num_fitpts,
              fitDatum: seg.fitpts,
              startTangent: seg.start_tangent,
              endTangent: seg.end_tangent
            };
          }
        });
        return {
          ...commonAttrs,
          numberOfEdges: path.num_segs_or_paths,
          edges
        };
      }
    });
    return converted;
  }
  convertImage(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const version = libredwg.dwg_dynapi_entity_value(entity, "class_version").data;
    const position = libredwg.dwg_dynapi_entity_value(entity, "pt0").data;
    const uPixel = libredwg.dwg_dynapi_entity_value(entity, "uvec").data;
    const vPixel = libredwg.dwg_dynapi_entity_value(entity, "vvec").data;
    const imageSize = libredwg.dwg_dynapi_entity_value(entity, "image_size").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "display_props").data;
    const clipping = libredwg.dwg_dynapi_entity_value(entity, "clipping").data;
    const brightness = libredwg.dwg_dynapi_entity_value(entity, "brightness").data;
    const contrast = libredwg.dwg_dynapi_entity_value(entity, "contrast").data;
    const fade = libredwg.dwg_dynapi_entity_value(entity, "fade").data;
    const clipMode = libredwg.dwg_dynapi_entity_value(entity, "clip_mode").data;
    const clippingBoundaryType = libredwg.dwg_dynapi_entity_value(
      entity,
      "clip_boundary_type"
    ).data;
    const countBoundaryPoints = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_clip_verts"
    ).data;
    const clip_verts = libredwg.dwg_dynapi_entity_value(entity, "clip_verts").data;
    const clippingBoundaryPath = libredwg.dwg_ptr_to_point3d_array(
      clip_verts,
      countBoundaryPoints
    );
    const imagedef_ref = libredwg.dwg_dynapi_entity_value(entity, "imagedef").data;
    const imageDefHandle = idToString(libredwg.dwg_ref_get_absref(imagedef_ref));
    const imagedefreactor_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "imagedefreactor"
    ).data;
    const imageDefReactorHandle = idToString(
      libredwg.dwg_ref_get_absref(imagedefreactor_ref)
    );
    return {
      type: "IMAGE",
      ...commonAttrs,
      version,
      position,
      uPixel,
      vPixel,
      imageSize,
      imageDefHandle,
      flags,
      clipping,
      brightness,
      contrast,
      fade,
      imageDefReactorHandle,
      clippingBoundaryType,
      countBoundaryPoints,
      clippingBoundaryPath,
      clipMode
    };
  }
  convertInsert(entity, commonAttrs) {
    const libredwg = this.libredwg;
    let name = "";
    const block_header_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "block_header"
    ).data;
    if (block_header_ref) {
      const block_header_obj = libredwg.dwg_ref_get_object(block_header_ref);
      if (block_header_obj) {
        const block_header_tio = libredwg.dwg_object_to_object_tio(block_header_obj);
        if (block_header_tio) {
          name = libredwg.dwg_entity_block_header_get_block(block_header_tio).name;
        }
      }
    }
    if (!name) {
      name = libredwg.dwg_dynapi_entity_value(entity, "block_name").data;
    }
    const insertionPoint = libredwg.dwg_dynapi_entity_value(entity, "ins_pt").data;
    const scale = libredwg.dwg_dynapi_entity_value(entity, "scale").data;
    const rotation = libredwg.dwg_dynapi_entity_value(entity, "rotation").data;
    const columnCount = libredwg.dwg_dynapi_entity_value(entity, "num_cols").data;
    const rowCount = libredwg.dwg_dynapi_entity_value(entity, "num_rows").data;
    const columnSpacing = libredwg.dwg_dynapi_entity_value(
      entity,
      "col_spacing"
    ).data;
    const rowSpacing = libredwg.dwg_dynapi_entity_value(entity, "row_spacing").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const attrib_ptr_array = libredwg.dwg_entity_insert_get_attribs(entity);
    const attribs = [];
    attrib_ptr_array.forEach((object_ptr) => {
      const entity2 = libredwg.dwg_object_to_entity(object_ptr);
      const entity_tio = libredwg.dwg_object_to_entity_tio(object_ptr);
      if (entity2 && entity_tio) {
        const commonAttrs2 = this.getCommonAttrs(entity2);
        const fixedtype = libredwg.dwg_object_get_fixedtype(object_ptr);
        if (fixedtype == Dwg_Object_Type.DWG_TYPE_ATTRIB) {
          attribs.push(this.convertAttrib(entity_tio, commonAttrs2));
        }
      }
    });
    return {
      type: "INSERT",
      ...commonAttrs,
      name,
      insertionPoint,
      xScale: scale ? scale.x : 1,
      yScale: scale ? scale.y : 1,
      zScale: scale ? scale.z : 1,
      rotation,
      columnCount,
      rowCount,
      columnSpacing,
      rowSpacing,
      extrusionDirection,
      attribs
    };
  }
  convertLeader(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const styleName = libredwg.dwg_entity_mtext_get_style_name(entity);
    const isArrowheadEnabled = libredwg.dwg_dynapi_entity_value(
      entity,
      "arrowhead_type"
    ).data;
    const isSpline = libredwg.dwg_dynapi_entity_value(entity, "path_type").data;
    const leaderCreationFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "annot_type"
    ).data;
    const isHooklineSameDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "hookline_dir"
    ).data;
    const isHooklineExists = libredwg.dwg_dynapi_entity_value(
      entity,
      "hookline_on"
    ).data;
    const textHeight = libredwg.dwg_dynapi_entity_value(entity, "box_height").data;
    const textWidth = libredwg.dwg_dynapi_entity_value(entity, "box_width").data;
    const numberOfVertices = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_points"
    ).data;
    const vertices_ptr = libredwg.dwg_dynapi_entity_value(entity, "points").data;
    const vertices = numberOfVertices > 0 ? libredwg.dwg_ptr_to_point3d_array(vertices_ptr, numberOfVertices) : [];
    const byBlockColor = libredwg.dwg_dynapi_entity_value(
      entity,
      "byblock_color"
    ).data;
    const normal = libredwg.dwg_dynapi_entity_value(entity, "extrusion").data;
    const horizontalDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "x_direction"
    ).data;
    const offsetFromBlock = libredwg.dwg_dynapi_entity_value(
      entity,
      "inspt_offset"
    ).data;
    const offsetFromAnnotation = libredwg.dwg_dynapi_entity_value(
      entity,
      "endptproj"
    ).data;
    return {
      type: "LEADER",
      ...commonAttrs,
      styleName,
      isArrowheadEnabled: isArrowheadEnabled > 0,
      isSpline: isSpline > 0,
      leaderCreationFlag,
      isHooklineSameDirection: isHooklineSameDirection > 0,
      isHooklineExists: isHooklineExists > 0,
      textHeight,
      textWidth,
      numberOfVertices,
      vertices,
      byBlockColor,
      normal,
      horizontalDirection,
      offsetFromBlock,
      offsetFromAnnotation
    };
  }
  convertLine(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const startPoint = libredwg.dwg_dynapi_entity_value(entity, "start").data;
    const endPoint = libredwg.dwg_dynapi_entity_value(entity, "end").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    return {
      type: "LINE",
      ...commonAttrs,
      thickness,
      startPoint,
      endPoint,
      extrusionDirection
    };
  }
  convertLWPolyline(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const numberOfVertices = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_points"
    ).data;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const constantWidth = libredwg.dwg_dynapi_entity_value(
      entity,
      "const_width"
    ).data;
    const elevation = libredwg.dwg_dynapi_entity_value(entity, "elevation").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const vertices = [];
    const num_points = libredwg.dwg_dynapi_entity_value(entity, "num_points").data;
    const points_ptr = libredwg.dwg_dynapi_entity_value(entity, "points").data;
    const points = libredwg.dwg_ptr_to_point2d_array(points_ptr, num_points);
    const num_bulges = libredwg.dwg_dynapi_entity_value(entity, "num_bulges").data;
    const bulges_ptr = libredwg.dwg_dynapi_entity_value(entity, "bulges").data;
    const bulges = libredwg.dwg_ptr_to_double_array(bulges_ptr, num_bulges);
    points.forEach((point, index) => {
      vertices.push({
        id: index,
        x: point.x,
        y: point.y,
        bulge: bulges.length > index ? bulges[index] : 0
      });
    });
    return {
      type: "LWPOLYLINE",
      ...commonAttrs,
      numberOfVertices,
      flag,
      constantWidth,
      elevation,
      thickness,
      extrusionDirection,
      vertices
    };
  }
  convertMLine(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const scale = libredwg.dwg_dynapi_entity_value(entity, "scale").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "flags").data;
    const justification = libredwg.dwg_dynapi_entity_value(
      entity,
      "justification"
    ).data;
    const startPoint = libredwg.dwg_dynapi_entity_value(entity, "base_point").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const numberOfLines = libredwg.dwg_dynapi_entity_value(entity, "num_lines").data;
    const numberOfVertices = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_verts"
    ).data;
    const verts_ptr = libredwg.dwg_dynapi_entity_value(entity, "verts").data;
    const verts = libredwg.dwg_ptr_to_mline_vertex_array(
      verts_ptr,
      numberOfVertices
    );
    const vertices = [];
    verts.forEach((vert) => {
      vertices.push({
        vertex: vert.vertex,
        vertexDirection: vert.vertex_direction,
        miterDirection: vert.miter_direction,
        numberOfLines: vert.num_lines,
        lines: vert.lines.map((line) => {
          return {
            numberOfSegmentParams: line.num_segparms,
            segmentParams: line.segparms,
            numberOfAreaFillParams: line.num_areafillparms,
            areaFillParams: line.areafillparms
          };
        })
      });
    });
    return {
      type: "MLINE",
      ...commonAttrs,
      scale,
      flags,
      justification,
      startPoint,
      extrusionDirection,
      numberOfLines,
      numberOfVertices,
      vertices,
      mlineStyle: ""
      // TODO: Set the correct value
    };
  }
  convertOle2Frame(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const oleVersion = libredwg.dwg_dynapi_entity_value(entity, "oleversion").data;
    const oleClient = libredwg.dwg_dynapi_entity_value(entity, "oleclient").data;
    const dataSize = libredwg.dwg_dynapi_entity_value(entity, "data_size").data;
    const leftUpPoint = libredwg.dwg_dynapi_entity_value(entity, "pt1").data;
    const rightDownPoint = libredwg.dwg_dynapi_entity_value(entity, "pt2").data;
    const lockAspect = libredwg.dwg_dynapi_entity_value(entity, "lock_aspect").data;
    const oleObjectType = libredwg.dwg_dynapi_entity_value(entity, "type").data;
    const tileModeDescriptor = libredwg.dwg_dynapi_entity_value(entity, "mode").data;
    const binaryData = libredwg.dwg_dynapi_entity_value(entity, "data").data;
    return {
      type: "OLE2FRAME",
      ...commonAttrs,
      oleVersion,
      oleClient,
      dataSize,
      leftUpPoint,
      rightDownPoint,
      lockAspect,
      oleObjectType,
      tileModeDescriptor,
      binaryData
    };
  }
  convertOleFrame(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const mode = libredwg.dwg_dynapi_entity_value(entity, "mode").data;
    const dataSize = libredwg.dwg_dynapi_entity_value(entity, "data_size").data;
    const binaryData = libredwg.dwg_dynapi_entity_value(entity, "data").data;
    return {
      type: "OLEFRAME",
      ...commonAttrs,
      flag,
      mode,
      dataSize,
      binaryData
    };
  }
  convertMText(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const insertionPoint = libredwg.dwg_dynapi_entity_value(entity, "ins_pt").data;
    const textHeight = libredwg.dwg_dynapi_entity_value(entity, "text_height").data;
    const rectHeight = libredwg.dwg_dynapi_entity_value(entity, "rect_height").data;
    const rectWidth = libredwg.dwg_dynapi_entity_value(entity, "rect_width").data;
    const extentsWidth = libredwg.dwg_dynapi_entity_value(
      entity,
      "extents_width"
    ).data;
    const extentsHeight = libredwg.dwg_dynapi_entity_value(
      entity,
      "extents_height"
    ).data;
    const attachmentPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "attachment"
    ).data;
    const drawingDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "flow_dir"
    ).data;
    const text = libredwg.dwg_dynapi_entity_value(entity, "text").data;
    const styleName = libredwg.dwg_entity_mtext_get_style_name(entity);
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const direction = libredwg.dwg_dynapi_entity_value(entity, "x_axis_dir").data;
    const lineSpacingStyle = libredwg.dwg_dynapi_entity_value(
      entity,
      "linespace_style"
    ).data;
    const lineSpacing = libredwg.dwg_dynapi_entity_value(
      entity,
      "linespace_factor"
    ).data;
    const backgroundFill = libredwg.dwg_dynapi_entity_value(
      entity,
      "bg_fill_flag"
    ).data;
    const fillBoxScale = libredwg.dwg_dynapi_entity_value(
      entity,
      "bg_fill_scale"
    ).data;
    const backgroundFillColor = libredwg.dwg_dynapi_entity_value(
      entity,
      "bg_fill_color"
    ).data;
    const backgroundFillTransparency = libredwg.dwg_dynapi_entity_value(
      entity,
      "bg_fill_trans"
    ).data;
    const columnType = libredwg.dwg_dynapi_entity_value(entity, "column_type").data;
    const columnFlowReversed = libredwg.dwg_dynapi_entity_value(
      entity,
      "flow_reversed"
    ).data;
    const columnAutoHeight = libredwg.dwg_dynapi_entity_value(
      entity,
      "auto_height"
    ).data;
    const columnWidth = libredwg.dwg_dynapi_entity_value(entity, "column_width").data;
    const columnGutter = libredwg.dwg_dynapi_entity_value(entity, "gutter").data;
    const columnHeightCount = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_column_heights"
    ).data;
    const columnHeights_ptr = libredwg.dwg_dynapi_entity_value(
      entity,
      "column_heights"
    ).data;
    const columnHeights = libredwg.dwg_ptr_to_double_array(
      columnHeights_ptr,
      columnHeightCount
    );
    return {
      type: "MTEXT",
      ...commonAttrs,
      insertionPoint,
      textHeight,
      rectHeight,
      rectWidth,
      extentsHeight,
      extentsWidth,
      attachmentPoint,
      drawingDirection,
      text,
      styleName,
      extrusionDirection,
      direction,
      rotation: 0,
      // TODO: Didn't find the corresponding field in libredwg
      lineSpacingStyle,
      lineSpacing,
      backgroundFill,
      // backgroundColor: backgroundColor.rgb, // TODO: Double check whether it should be color index
      fillBoxScale,
      backgroundFillColor: backgroundFillColor.rgb,
      // TODO: Double check whether it should be color index
      backgroundFillTransparency,
      columnType,
      // columnCount: columnCount,
      columnFlowReversed,
      columnAutoHeight,
      columnWidth,
      columnGutter,
      columnHeightCount,
      columnHeights
    };
  }
  convertPoint(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const x = libredwg.dwg_dynapi_entity_value(entity, "x").data;
    const y = libredwg.dwg_dynapi_entity_value(entity, "y").data;
    const z = libredwg.dwg_dynapi_entity_value(entity, "z").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const angle = libredwg.dwg_dynapi_entity_value(entity, "x_ang").data;
    return {
      type: "POINT",
      ...commonAttrs,
      position: { x, y, z },
      thickness,
      extrusionDirection,
      angle
    };
  }
  convertPolyline2d(entity, commonAttrs, object) {
    const libredwg = this.libredwg;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const smoothType = libredwg.dwg_dynapi_entity_value(entity, "curve_type").data;
    const startWidth = libredwg.dwg_dynapi_entity_value(entity, "start_width").data;
    const endWidth = libredwg.dwg_dynapi_entity_value(entity, "end_width").data;
    const elevation = libredwg.dwg_dynapi_entity_value(entity, "elevation").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const vertices = libredwg.dwg_entity_polyline_2d_get_vertices(object);
    return {
      type: "POLYLINE2D",
      ...commonAttrs,
      flag,
      smoothType,
      startWidth,
      endWidth,
      elevation,
      thickness,
      extrusionDirection,
      vertices: vertices.map((vertex) => {
        return {
          x: vertex.point.x,
          y: vertex.point.y,
          z: vertex.point.z,
          startWidth: vertex.start_width,
          endWidth: vertex.end_width,
          bulge: vertex.bulge,
          flag: vertex.flag,
          tangentDirection: vertex.tangent_dir
        };
      }),
      meshMVertexCount: 0,
      meshNVertexCount: 0,
      surfaceMDensity: 0,
      surfaceNDensity: 0
    };
  }
  convertPolyline3d(entity, commonAttrs, object) {
    const libredwg = this.libredwg;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const smoothType = libredwg.dwg_dynapi_entity_value(entity, "curve_type").data;
    const startWidth = libredwg.dwg_dynapi_entity_value(entity, "start_width").data;
    const endWidth = libredwg.dwg_dynapi_entity_value(entity, "end_width").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const vertices = libredwg.dwg_entity_polyline_3d_get_vertices(object);
    return {
      type: "POLYLINE3D",
      ...commonAttrs,
      flag,
      smoothType,
      startWidth,
      endWidth,
      extrusionDirection,
      vertices: vertices.map((vertex) => {
        return {
          x: vertex.point.x,
          y: vertex.point.y,
          z: vertex.point.z,
          flag: vertex.flag
        };
      })
    };
  }
  convertProxyEntity(entity, commonAttrs, objectPtr) {
    const libredwg = this.libredwg;
    const proxyEntityClassId = libredwg.dwg_dynapi_entity_value(
      entity,
      "proxy_id"
    ).data;
    const applicationEntityClassId = libredwg.dwg_dynapi_entity_value(
      entity,
      "class_id"
    ).data;
    const entityDataSize = libredwg.dwg_dynapi_entity_value(
      entity,
      "data_numbits"
    ).data;
    const objectDrawingFormat = libredwg.dwg_dynapi_entity_value(
      entity,
      "version"
    ).data;
    const fromDxf = libredwg.dwg_dynapi_entity_value(entity, "from_dxf").data;
    const numObjIds = libredwg.dwg_dynapi_entity_value(entity, "num_objids").data;
    const graphicsBytes = libredwg.dwg_entity_get_preview(objectPtr);
    const graphicsDataSize = (graphicsBytes == null ? void 0 : graphicsBytes.length) ?? 0;
    const entityBytes = libredwg.dwg_entity_proxy_entity_get_entity_data(entity);
    const graphicsData = graphicsBytes ? uint8ArrayToHexString(graphicsBytes) : void 0;
    const entityData = entityBytes ? uint8ArrayToHexString(entityBytes) : void 0;
    let linkedObjectIds;
    if (numObjIds > 0) {
      const objidsPtr = libredwg.dwg_dynapi_entity_value(entity, "objids").data;
      if (objidsPtr) {
        const objids = libredwg.dwg_ptr_to_object_ref_array(
          objidsPtr,
          numObjIds
        );
        linkedObjectIds = objids.map((ref) => idToString(ref.absolute_ref));
      }
    }
    const originalDxfName = this.getOriginalDxfName(applicationEntityClassId);
    const result = {
      type: "ACAD_PROXY_ENTITY",
      subclassMarker: "AcDbProxyEntity",
      ...commonAttrs,
      proxyEntityClassId: proxyEntityClassId || 498,
      applicationEntityClassId
    };
    if (originalDxfName) {
      result.originalDxfName = originalDxfName;
    }
    if (graphicsDataSize > 0) {
      result.graphicsDataSize = graphicsDataSize;
    }
    if (graphicsData) {
      result.graphicsData = graphicsData;
    }
    if (entityDataSize > 0) {
      result.entityDataSize = entityDataSize;
    }
    if (entityData) {
      result.entityData = entityData;
    }
    if (linkedObjectIds && linkedObjectIds.length > 0) {
      result.linkedObjectIds = linkedObjectIds;
    }
    if (objectDrawingFormat) {
      result.objectDrawingFormat = objectDrawingFormat;
    }
    if (fromDxf === 0 || fromDxf === 1) {
      result.originalDataFormat = fromDxf;
    }
    return result;
  }
  getOriginalDxfName(classId) {
    if (this.classes.length === 0 || classId < 0) {
      return void 0;
    }
    const index = classId >= 500 ? classId - 500 : classId;
    if (index >= 0 && index < this.classes.length) {
      return this.classes[index].dxfName;
    }
    return void 0;
  }
  convertRay(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const firstPoint = libredwg.dwg_dynapi_entity_value(entity, "point").data;
    const unitDirection = libredwg.dwg_dynapi_entity_value(entity, "vector").data;
    return {
      type: "RAY",
      ...commonAttrs,
      firstPoint,
      unitDirection
    };
  }
  convertSection(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const state = libredwg.dwg_dynapi_entity_value(entity, "state").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const name = libredwg.dwg_dynapi_entity_value(entity, "name").data;
    const verticalDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "vert_dir"
    ).data;
    const topHeight = libredwg.dwg_dynapi_entity_value(entity, "top_height").data;
    const bottomHeight = libredwg.dwg_dynapi_entity_value(
      entity,
      "bottom_height"
    ).data;
    const indicatorTransparency = libredwg.dwg_dynapi_entity_value(
      entity,
      "indicator_alpha"
    ).data;
    const indicatorColor = libredwg.dwg_dynapi_entity_value(
      entity,
      "indicator_color"
    ).data;
    const numberOfVertices = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_verts"
    ).data;
    const vertices_ptr = libredwg.dwg_dynapi_entity_value(entity, "verts").data;
    const vertices = numberOfVertices > 0 ? libredwg.dwg_ptr_to_point3d_array(vertices_ptr, numberOfVertices) : [];
    const numberOfBackLineVertices = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_blverts"
    ).data;
    const backLineVertices_ptr = libredwg.dwg_dynapi_entity_value(
      entity,
      "blverts"
    ).data;
    const backLineVertices = numberOfBackLineVertices > 0 ? libredwg.dwg_ptr_to_point3d_array(
      backLineVertices_ptr,
      numberOfBackLineVertices
    ) : [];
    const geometrySettingHandle = libredwg.dwg_dynapi_entity_value(
      entity,
      "geometrySettingHardId"
    ).data;
    const geometrySettingHardId = libredwg.dwg_ref_get_handle_absolute_ref(
      geometrySettingHandle
    );
    return {
      type: "SECTION",
      ...commonAttrs,
      state,
      flags,
      name,
      verticalDirection,
      topHeight,
      bottomHeight,
      indicatorTransparency,
      indicatorColor: indicatorColor.rgb,
      numberOfVertices,
      vertices,
      numberOfBackLineVertices,
      backLineVertices,
      geometrySettingHardId
    };
  }
  convertSolid(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const corner1 = libredwg.dwg_dynapi_entity_value(entity, "corner1").data;
    const corner2 = libredwg.dwg_dynapi_entity_value(entity, "corner2").data;
    const corner3 = libredwg.dwg_dynapi_entity_value(entity, "corner3").data;
    const corner4 = libredwg.dwg_dynapi_entity_value(entity, "corner4").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    return {
      type: "SOLID",
      ...commonAttrs,
      corner1,
      corner2,
      corner3,
      corner4,
      thickness,
      extrusionDirection
    };
  }
  convertSpline(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const flag = libredwg.dwg_dynapi_entity_value(entity, "splineflags").data;
    const degree = libredwg.dwg_dynapi_entity_value(entity, "degree").data;
    const knotTolerance = libredwg.dwg_dynapi_entity_value(entity, "knot_tol").data;
    const numberOfKnots = libredwg.dwg_dynapi_entity_value(entity, "num_knots").data;
    const knots_ptr = libredwg.dwg_dynapi_entity_value(entity, "knots").data;
    const knots = libredwg.dwg_ptr_to_double_array(knots_ptr, numberOfKnots);
    const fitTolerance = libredwg.dwg_dynapi_entity_value(entity, "fit_tol").data;
    const numberOfFitPoints = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_fit_pts"
    ).data;
    const fit_pts_ptr = libredwg.dwg_dynapi_entity_value(entity, "fit_pts").data;
    const fitPoints = libredwg.dwg_ptr_to_point3d_array(
      fit_pts_ptr,
      numberOfFitPoints
    );
    const weighted = libredwg.dwg_dynapi_entity_value(entity, "weighted").data;
    const controlTolerance = libredwg.dwg_dynapi_entity_value(
      entity,
      "ctrl_tol"
    ).data;
    const numberOfControlPoints = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_ctrl_pts"
    ).data;
    const ctrl_pts_ptr = libredwg.dwg_dynapi_entity_value(entity, "ctrl_pts").data;
    const controlPoints = libredwg.dwg_ptr_to_point4d_array(
      ctrl_pts_ptr,
      numberOfControlPoints
    );
    const startTangent = libredwg.dwg_dynapi_entity_value(entity, "beg_tan_vec").data;
    const endTangent = libredwg.dwg_dynapi_entity_value(entity, "end_tan_vec").data;
    return {
      type: "SPLINE",
      ...commonAttrs,
      // normal?: DwgPoint3D
      flag,
      degree,
      numberOfKnots,
      numberOfControlPoints,
      numberOfFitPoints,
      knotTolerance,
      controlTolerance,
      fitTolerance,
      startTangent,
      endTangent,
      knots,
      weights: weighted ? controlPoints.map((value) => value.w) : void 0,
      controlPoints: controlPoints.map((value) => {
        return {
          x: value.x,
          y: value.y,
          z: value.z
        };
      }),
      fitPoints
    };
  }
  convertTable(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const name = libredwg.dwg_dynapi_subclass_value(entity, "ldata", "name").data;
    const startPoint = libredwg.dwg_dynapi_entity_value(entity, "ins_pt").data;
    const directionVector = libredwg.dwg_dynapi_entity_value(
      entity,
      "horiz_direction"
    ).data;
    const tableValue = libredwg.dwg_dynapi_entity_value(
      entity,
      "flag_for_table_value"
    ).data;
    const rowCount = libredwg.dwg_dynapi_entity_value(entity, "num_rows").data;
    const columnCount = libredwg.dwg_dynapi_entity_value(entity, "num_cols").data;
    const row_heights_ptr = libredwg.dwg_dynapi_entity_value(
      entity,
      "row_heights"
    ).data;
    const rowHeightArr = libredwg.dwg_ptr_to_double_array(
      row_heights_ptr,
      rowCount
    );
    const col_widths_ptr = libredwg.dwg_dynapi_entity_value(
      entity,
      "col_widths"
    ).data;
    const columnWidthArr = libredwg.dwg_ptr_to_double_array(
      col_widths_ptr,
      columnCount
    );
    const table_style_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "tablestyle"
    ).data;
    const tableStyleId = idToString(
      libredwg.dwg_ref_get_absref(table_style_ref)
    );
    const block_header_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "block_header"
    ).data;
    const blockRecordHandle = idToString(
      libredwg.dwg_ref_get_absref(block_header_ref)
    );
    const overrideFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "table_flag_override"
    ).data;
    const borderColorOverrideFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "border_color_overrides_flag"
    ).data;
    const borderLineWeightOverrideFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "border_lineweight_overrides_flag"
    ).data;
    const borderVisibilityOverrideFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "border_visibility_overrides_flag"
    ).data;
    const num_cells = libredwg.dwg_dynapi_entity_value(entity, "num_cells").data;
    const cells_ptr = libredwg.dwg_dynapi_entity_value(entity, "cells").data;
    const cells = libredwg.dwg_ptr_to_table_cell_array(cells_ptr, num_cells);
    return {
      type: "ACAD_TABLE",
      ...commonAttrs,
      name,
      startPoint,
      directionVector,
      // attachmentPoint: DwgAttachmentPoint
      tableValue,
      rowCount,
      columnCount,
      overrideFlag,
      borderColorOverrideFlag,
      borderLineWeightOverrideFlag,
      borderVisibilityOverrideFlag,
      rowHeightArr,
      columnWidthArr,
      tableStyleId,
      blockRecordHandle,
      cells: this.convertTableCells(cells),
      bmpPreview: ""
    };
  }
  convertTableCells(cells) {
    const converted = [];
    cells.forEach((cell) => {
      return {
        text: cell.text_value,
        attachmentPoint: cell.cell_alignment,
        textStyle: cell.text_style,
        // TODO: Set the text style name instead of handle
        rotation: cell.rotation,
        cellType: cell.type,
        flagValue: cell.flags,
        mergedValue: cell.is_merged_value,
        autoFit: cell.is_autofit_flag,
        // borderWidth?: number
        // borderHeight?: number
        topBorderVisibility: cell.top_visibility,
        bottomBorderVisibility: cell.bottom_visibility,
        leftBorderVisibility: cell.left_visibility,
        rightBorderVisibility: cell.right_visibility,
        overrideFlag: cell.cell_flag_override,
        virtualEdgeFlag: cell.virtual_edge_flag,
        // fieldObjetId?: string
        blockTableRecordI: cell.block_handle.absolute_ref,
        blockScale: cell.block_scale,
        blockAttrNum: cell.attr_defs.length,
        attrDefineId: cell.attr_defs.map((value) => value.attdef.absolute_ref),
        // attrText?: string
        // textHeight: number
        extendedCellFlags: cell.additional_data_flag
      };
    });
    return converted;
  }
  convertTextBase(entity) {
    const libredwg = this.libredwg;
    const text = libredwg.dwg_dynapi_entity_value(entity, "text_value").data;
    const thickness = libredwg.dwg_dynapi_entity_value(entity, "thickness").data;
    const startPoint = libredwg.dwg_dynapi_entity_value(entity, "ins_pt").data;
    const endPoint = libredwg.dwg_dynapi_entity_value(entity, "alignment_pt").data;
    const rotation = libredwg.dwg_dynapi_entity_value(entity, "rotation").data;
    const textHeight = libredwg.dwg_dynapi_entity_value(entity, "height").data;
    const xScale = libredwg.dwg_dynapi_entity_value(entity, "width_factor").data;
    const obliqueAngle = libredwg.dwg_dynapi_entity_value(
      entity,
      "oblique_angle"
    ).data;
    const styleName = libredwg.dwg_entity_text_get_style_name(entity);
    const generationFlag = libredwg.dwg_dynapi_entity_value(
      entity,
      "generation"
    ).data;
    const halign = libredwg.dwg_dynapi_entity_value(entity, "horiz_alignment").data;
    const valign = libredwg.dwg_dynapi_entity_value(entity, "vert_alignment").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    return {
      text,
      thickness,
      startPoint,
      endPoint,
      textHeight,
      rotation,
      xScale,
      obliqueAngle,
      styleName,
      generationFlag,
      halign,
      valign,
      extrusionDirection
    };
  }
  convertText(entity, commonAttrs) {
    return {
      type: "TEXT",
      ...commonAttrs,
      ...this.convertTextBase(entity)
    };
  }
  convertTolerance(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const insertionPoint = libredwg.dwg_dynapi_entity_value(entity, "ins_pt").data;
    const text = libredwg.dwg_dynapi_entity_value(entity, "text_value").data;
    const xAxisDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "x_direction"
    ).data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const dimStyleName = libredwg.dwg_entity_get_dimstyle_name(entity);
    return {
      type: "TOLERANCE",
      ...commonAttrs,
      styleName: dimStyleName,
      insertionPoint,
      text,
      extrusionDirection,
      xAxisDirection
    };
  }
  convertViewport(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const viewportCenter = libredwg.dwg_dynapi_entity_value(entity, "center").data;
    const width = libredwg.dwg_dynapi_entity_value(entity, "width").data;
    const height = libredwg.dwg_dynapi_entity_value(entity, "height").data;
    const status = libredwg.dwg_dynapi_entity_value(entity, "on_off").data;
    const displayCenter = libredwg.dwg_dynapi_entity_value(entity, "VIEWCTR").data;
    const snapBase = libredwg.dwg_dynapi_entity_value(entity, "SNAPBASE").data;
    const snapSpacing = libredwg.dwg_dynapi_entity_value(entity, "SNAPUNIT").data;
    const gridSpacing = libredwg.dwg_dynapi_entity_value(entity, "GRIDUNIT").data;
    const viewDirection = libredwg.dwg_dynapi_entity_value(entity, "VIEWDIR").data;
    const targetPoint = libredwg.dwg_dynapi_entity_value(entity, "view_target").data;
    const perspectiveLensLength = libredwg.dwg_dynapi_entity_value(
      entity,
      "lens_length"
    ).data;
    const frontClipZ = libredwg.dwg_dynapi_entity_value(entity, "front_clip_z").data;
    const backClipZ = libredwg.dwg_dynapi_entity_value(entity, "back_clip_z").data;
    const viewHeight = libredwg.dwg_dynapi_entity_value(entity, "VIEWSIZE").data;
    const snapAngle = libredwg.dwg_dynapi_entity_value(entity, "SNAPANG").data;
    const viewTwistAngle = libredwg.dwg_dynapi_entity_value(
      entity,
      "twist_angle"
    ).data;
    const circleZoomPercent = libredwg.dwg_dynapi_entity_value(
      entity,
      "circle_zoom"
    ).data;
    const statusBitFlags = libredwg.dwg_dynapi_entity_value(
      entity,
      "status_flag"
    ).data;
    const sheetName = libredwg.dwg_dynapi_entity_value(entity, "style_sheet").data;
    const renderMode = libredwg.dwg_dynapi_entity_value(entity, "render_mode").data;
    const ucsPerViewport = libredwg.dwg_dynapi_entity_value(entity, "UCSVP").data;
    const ucsOrigin = libredwg.dwg_dynapi_entity_value(entity, "ucsorg").data;
    const ucsXAxis = libredwg.dwg_dynapi_entity_value(entity, "ucsxdir").data;
    const ucsYAxis = libredwg.dwg_dynapi_entity_value(entity, "ucsydir").data;
    const named_ucs_ref = libredwg.dwg_dynapi_entity_value(entity, "named_ucs").data;
    const ucsId = libredwg.dwg_ref_get_absref(named_ucs_ref);
    const base_ucs_ref = libredwg.dwg_dynapi_entity_value(entity, "base_ucs").data;
    const ucsBaseId = libredwg.dwg_ref_get_absref(base_ucs_ref);
    const orthographicType = libredwg.dwg_dynapi_entity_value(
      entity,
      "UCSORTHOVIEW"
    ).data;
    const elevation = libredwg.dwg_dynapi_entity_value(entity, "ucs_elevation").data;
    const shadePlotMode = libredwg.dwg_dynapi_entity_value(
      entity,
      "shadeplot_mode"
    ).data;
    const isDefaultLighting = libredwg.dwg_dynapi_entity_value(
      entity,
      "use_default_lights"
    ).data;
    const defaultLightingType = libredwg.dwg_dynapi_entity_value(
      entity,
      "default_lighting_type"
    ).data;
    const brightness = libredwg.dwg_dynapi_entity_value(entity, "brightness").data;
    const contrast = libredwg.dwg_dynapi_entity_value(entity, "contrast").data;
    const majorGridFrequency = libredwg.dwg_dynapi_entity_value(
      entity,
      "grid_major"
    ).data;
    const background_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "background"
    ).data;
    const backgroundId = libredwg.dwg_ref_get_absref(background_ref);
    const shadeplot_ref = libredwg.dwg_dynapi_entity_value(entity, "shadeplot").data;
    const shadePlotId = libredwg.dwg_ref_get_absref(shadeplot_ref);
    const visualstyle_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "visualstyle"
    ).data;
    const visualStyleId = libredwg.dwg_ref_get_absref(visualstyle_ref);
    const sun_ref = libredwg.dwg_dynapi_entity_value(entity, "sun").data;
    const sunId = libredwg.dwg_ref_get_absref(sun_ref);
    return {
      type: "VIEWPORT",
      ...commonAttrs,
      viewportCenter,
      width,
      height,
      status,
      viewportId: 0,
      // Will be set later in LibreDwgConverter.convert
      displayCenter,
      snapBase,
      snapSpacing,
      gridSpacing,
      viewDirection,
      targetPoint,
      perspectiveLensLength,
      frontClipZ,
      backClipZ,
      viewHeight,
      snapAngle,
      viewTwistAngle,
      circleZoomPercent,
      statusBitFlags,
      sheetName,
      renderMode,
      ucsPerViewport,
      ucsOrigin,
      ucsXAxis,
      ucsYAxis,
      ucsId: idToString(ucsId),
      ucsBaseId: idToString(ucsBaseId),
      orthographicType,
      elevation,
      shadePlotMode,
      majorGridFrequency,
      backgroundId: idToString(backgroundId),
      shadePlotId: idToString(shadePlotId),
      visualStyleId: idToString(visualStyleId),
      isDefaultLighting: !!isDefaultLighting,
      defaultLightingType,
      brightness,
      contrast,
      sunId: idToString(sunId)
    };
  }
  convertWipeout(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const version = libredwg.dwg_dynapi_entity_value(entity, "class_version").data;
    const position = libredwg.dwg_dynapi_entity_value(entity, "pt0").data;
    const uPixel = libredwg.dwg_dynapi_entity_value(entity, "uvec").data;
    const vPixel = libredwg.dwg_dynapi_entity_value(entity, "vvec").data;
    const imageSize = libredwg.dwg_dynapi_entity_value(entity, "image_size").data;
    const flags = libredwg.dwg_dynapi_entity_value(entity, "display_props").data;
    const clipping = libredwg.dwg_dynapi_entity_value(entity, "clipping").data;
    const brightness = libredwg.dwg_dynapi_entity_value(entity, "brightness").data;
    const contrast = libredwg.dwg_dynapi_entity_value(entity, "contrast").data;
    const fade = libredwg.dwg_dynapi_entity_value(entity, "fade").data;
    const clipMode = libredwg.dwg_dynapi_entity_value(entity, "clip_mode").data;
    const clippingBoundaryType = libredwg.dwg_dynapi_entity_value(
      entity,
      "clip_boundary_type"
    ).data;
    const countBoundaryPoints = libredwg.dwg_dynapi_entity_value(
      entity,
      "num_clip_verts"
    ).data;
    const clip_verts = libredwg.dwg_dynapi_entity_value(entity, "clip_verts").data;
    const clippingBoundaryPath = libredwg.dwg_ptr_to_point2d_array(
      clip_verts,
      countBoundaryPoints
    );
    const imagedef_ref = libredwg.dwg_dynapi_entity_value(entity, "imagedef").data;
    const imageDefHandle = libredwg.dwg_ref_get_absref(imagedef_ref);
    const imagedefreactor_ref = libredwg.dwg_dynapi_entity_value(
      entity,
      "imagedefreactor"
    ).data;
    const imageDefReactorHandle = libredwg.dwg_ref_get_absref(imagedefreactor_ref);
    return {
      type: "WIPEOUT",
      ...commonAttrs,
      version,
      position,
      uPixel,
      vPixel,
      imageSize,
      imageDefHandle,
      flags,
      clipping,
      brightness,
      contrast,
      fade,
      imageDefReactorHandle,
      clippingBoundaryType,
      countBoundaryPoints,
      clippingBoundaryPath,
      clipMode
    };
  }
  convertXline(entity, commonAttrs) {
    const libredwg = this.libredwg;
    const firstPoint = libredwg.dwg_dynapi_entity_value(entity, "point").data;
    const unitDirection = libredwg.dwg_dynapi_entity_value(entity, "vector").data;
    return {
      type: "XLINE",
      ...commonAttrs,
      firstPoint,
      unitDirection
    };
  }
  getDimensionCommonAttrs(entity) {
    const libredwg = this.libredwg;
    const version = libredwg.dwg_dynapi_entity_value(entity, "class_version").data;
    const name = libredwg.dwg_entity_get_block_name(entity, "block");
    const definitionPoint = libredwg.dwg_dynapi_entity_value(entity, "def_pt").data;
    const textPoint = libredwg.dwg_dynapi_entity_value(entity, "text_midpt").data;
    const attachmentPoint = libredwg.dwg_dynapi_entity_value(
      entity,
      "attachmentPoint"
    ).data;
    const dimensionType = libredwg.dwg_dynapi_entity_value(entity, "flag").data;
    const textLineSpacingStyle = libredwg.dwg_dynapi_entity_value(
      entity,
      "lspace_factor"
    ).data;
    const textLineSpacingFactor = libredwg.dwg_dynapi_entity_value(
      entity,
      "lspace_factor"
    ).data;
    const measurement = libredwg.dwg_dynapi_entity_value(
      entity,
      "act_measurement"
    ).data;
    const text = libredwg.dwg_dynapi_entity_value(entity, "user_text").data;
    const textRotation = libredwg.dwg_dynapi_entity_value(
      entity,
      "text_rotation"
    ).data;
    const ocsRotation = libredwg.dwg_dynapi_entity_value(entity, "ins_rotation").data;
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      entity,
      "extrusion"
    ).data;
    const styleName = libredwg.dwg_entity_get_dimstyle_name(entity);
    return {
      type: "DIMENSION",
      version,
      name,
      definitionPoint,
      textPoint,
      dimensionType,
      attachmentPoint,
      textLineSpacingStyle,
      textLineSpacingFactor: textLineSpacingFactor || 1,
      measurement,
      text,
      textRotation,
      ocsRotation,
      extrusionDirection,
      styleName
    };
  }
  getCommonAttrs(entity) {
    const libredwg = this.libredwg;
    const color = libredwg.dwg_object_entity_get_color_object(entity);
    const method = color.method;
    const colorIndex = color.index;
    let rgbColor = void 0;
    if (method == 194 || (color.rgb >>> 24 & 255) === 194) {
      rgbColor = color.rgb & 16777215;
    }
    const layer = this.getLayerName(entity);
    const handle = libredwg.dwg_object_entity_get_handle_object(entity);
    const ownerhandle = libredwg.dwg_object_entity_get_ownerhandle_object(entity);
    const ownerDictionaryHardId = libredwg.dwg_object_entity_get_xdicobjhandle_object(entity);
    const lineType = this.getLtypeName(entity);
    const lineweight = libredwg.dwg_object_entity_get_line_weight(entity);
    const lineTypeScale = libredwg.dwg_object_entity_get_ltype_scale(entity);
    const isVisible = !libredwg.dwg_object_entity_get_invisible(entity);
    const xdata = libredwg.dwg_object_entity_get_xdata(entity);
    return {
      handle: idToString(handle.value),
      ownerDictionaryHardId: idToString(ownerDictionaryHardId.absolute_ref),
      ownerBlockRecordSoftId: idToString(ownerhandle.absolute_ref),
      layer,
      color: rgbColor,
      colorIndex,
      colorName: color.name,
      lineType,
      lineweight,
      lineTypeScale,
      isVisible,
      transparency: color.alpha,
      transparencyType: color.alpha_type,
      xdata
    };
  }
  getLayerName(entity) {
    const libredwg = this.libredwg;
    const layer = libredwg.dwg_object_entity_get_layer_object_ref(entity);
    const name = this.layers.get(idToString(layer.handleref.value));
    return name ?? "0";
  }
  getLtypeName(entity) {
    const libredwg = this.libredwg;
    const ltype = libredwg.dwg_object_entity_get_ltype_object_ref(entity);
    const name = this.ltypes.get(idToString(ltype.handleref.value));
    return name ?? "";
  }
}
class LibreDwgConverter {
  constructor(instance) {
    __publicField(this, "libredwg");
    __publicField(this, "entityConverter");
    this.libredwg = instance;
    this.entityConverter = new LibreEntityConverter(instance);
  }
  convert(data) {
    this.entityConverter.clear();
    const db = {
      tables: {
        APPID: {
          entries: []
        },
        BLOCK_RECORD: {
          entries: []
        },
        DIMSTYLE: {
          entries: []
        },
        LAYER: {
          entries: []
        },
        LTYPE: {
          entries: []
        },
        STYLE: {
          entries: []
        },
        VPORT: {
          entries: []
        }
      },
      objects: {
        DICTIONARY: [],
        IMAGEDEF: [],
        LAYOUT: [],
        SPATIAL_FILTER: []
      },
      header: {},
      entities: [],
      classes: []
    };
    const libredwg = this.libredwg;
    this.convertHeader(data, db.header);
    this.convertClasses(data, db.classes);
    this.entityConverter.setClasses(db.classes);
    const num_objects = libredwg.dwg_get_num_objects(data);
    for (let i = 0; i < num_objects; i++) {
      const obj = libredwg.dwg_get_object(data, i);
      if (obj) {
        const tio = this.safeObjectTio(obj);
        if (tio) {
          const fixedtype = libredwg.dwg_object_get_fixedtype(obj);
          switch (fixedtype) {
            case Dwg_Object_Type.DWG_TYPE_LAYER:
              {
                const layer = this.convertLayer(tio, obj);
                db.tables.LAYER.entries.push(layer);
                this.entityConverter.layers.set(layer.handle, layer.name);
              }
              break;
            case Dwg_Object_Type.DWG_TYPE_LTYPE:
              {
                const ltype = this.convertLineType(tio, obj);
                db.tables.LTYPE.entries.push(ltype);
                this.entityConverter.ltypes.set(ltype.handle, ltype.name);
              }
              break;
          }
        }
      }
    }
    for (let i = 0; i < num_objects; i++) {
      const obj = libredwg.dwg_get_object(data, i);
      if (obj) {
        const tio = this.safeObjectTio(obj);
        if (tio) {
          const fixedtype = libredwg.dwg_object_get_fixedtype(obj);
          switch (fixedtype) {
            case Dwg_Object_Type.DWG_TYPE_APPID:
              db.tables.APPID.entries.push(this.convertAppId(tio));
              break;
            case Dwg_Object_Type.DWG_TYPE_BLOCK_HEADER:
              {
                const btr = this.convertBlockRecord(tio, obj);
                db.tables.BLOCK_RECORD.entries.push(btr);
                if (isModelSpace(btr.name) || isPaperSpace(btr.name)) {
                  btr.entities.forEach((entity) => {
                    db.entities.push(entity);
                    if (entity.type === "INSERT") {
                      entity.attribs.forEach((attrib) => {
                        db.entities.push(attrib);
                      });
                    }
                  });
                }
              }
              break;
            case Dwg_Object_Type.DWG_TYPE_DIMSTYLE:
              db.tables.DIMSTYLE.entries.push(this.convertDimStyle(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_STYLE:
              db.tables.STYLE.entries.push(this.convertStyle(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_VPORT:
              db.tables.VPORT.entries.push(this.convertViewport(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_DICTIONARY:
              db.objects.DICTIONARY.push(this.convertDictionary(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_IMAGEDEF:
              db.objects.IMAGEDEF.push(this.convertImageDef(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_LAYOUT:
              db.objects.LAYOUT.push(this.convertLayout(tio, obj));
              break;
            case Dwg_Object_Type.DWG_TYPE_SPATIAL_FILTER:
              db.objects.SPATIAL_FILTER.push(
                this.convertSpatialFilter(tio, obj)
              );
              break;
          }
        }
      }
    }
    const viewportEntities = db.entities.filter(
      (entity) => entity.type === "VIEWPORT"
    );
    viewportEntities.sort((a, b) => {
      const handleA = parseInt(a.handle, 16);
      const handleB = parseInt(b.handle, 16);
      return handleA - handleB;
    });
    viewportEntities.forEach((viewport, index) => {
      viewport.viewportId = index + 1;
    });
    return db;
  }
  getConversionStats() {
    return {
      unknownEntityCount: this.entityConverter.unknownEntityCount
    };
  }
  safeObjectTio(obj) {
    const libredwg = this.libredwg;
    try {
      if (libredwg.dwg_object_get_supertype(obj) != Dwg_Object_Supertype.DWG_SUPERTYPE_OBJECT) {
        return null;
      }
      const tio = libredwg.dwg_object_to_object_tio(obj);
      return tio ? tio : null;
    } catch {
      return null;
    }
  }
  convertHeader(data, header) {
    const libredwg = this.libredwg;
    HEADER_VARIABLES.forEach((name) => {
      let var_name = name;
      if (name == "DIMBLK" || name == "DIMBLK1" || name == "DIMBLK2") {
        var_name = var_name + "_T";
      }
      let value = libredwg.dwg_dynapi_header_value(data, var_name).data;
      if (name == "CELTYPE" || name == "CLAYER" || name == "CLAYER" || name == "DIMSTYLE" || name == "DIMTXSTY" || name == "TEXTSTYLE") {
        value = value ? libredwg.dwg_ref_get_object_name(value) : "";
      } else if (name == "DRAGVS") {
        value = value ? libredwg.dwg_ref_get_absref(value) : 2;
      }
      header[name] = value;
    });
  }
  convertClasses(data, classes) {
    const libredwg = this.libredwg;
    const count = libredwg.dwg_get_num_classes(data);
    for (let index = 0; index < count; index++) {
      const cls = libredwg.dwg_get_class(data, index);
      classes.push({
        dxfName: cls.dxfname,
        cppName: cls.cppname,
        appName: cls.appname,
        capabilitiesFlag: cls.proxyflag,
        instanceCount: cls.num_instances,
        wasAProxyFlag: cls.s_zombie,
        // DWG_TYPE_PROXY_ENTITY = 0x1F2 /* 498 */,
        // DWG_TYPE_PROXY_OBJECT = 0x1F3 /* 499 */,
        isAnEntityFlag: cls.item_class_id === 498
      });
    }
  }
  convertAppId(item) {
    const libredwg = this.libredwg;
    const name = libredwg.dwg_dynapi_entity_value(item, "name").data;
    const flag = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    return {
      name,
      standardFlag: flag
    };
  }
  convertBlockRecord(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const block = libredwg.dwg_entity_block_header_get_block(item);
    if (block.name) {
      commonAttrs.name = block.name;
    }
    const num_owned = libredwg.dwg_dynapi_entity_value(item, "num_owned").data;
    const flags = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    const description = libredwg.dwg_dynapi_entity_value(item, "description").data;
    const basePoint = libredwg.dwg_dynapi_entity_value(item, "base_pt").data;
    const insertionUnits = libredwg.dwg_dynapi_entity_value(
      item,
      "insert_units"
    ).data;
    const explodability = libredwg.dwg_dynapi_entity_value(item, "explodable").data;
    const scalability = libredwg.dwg_dynapi_entity_value(item, "block_scaling").data;
    const layout_ptr = libredwg.dwg_dynapi_entity_value(item, "layout").data;
    const layout = idToString(libredwg.dwg_ref_get_absref(layout_ptr));
    let bmpPreview = "";
    const uint8ArrayToHexString2 = (bytes) => {
      const hexChars = new Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        hexChars[i] = bytes[i].toString(16).toUpperCase();
      }
      return hexChars.join("");
    };
    const bmpPreviewBinaryData = libredwg.dwg_entity_block_header_get_preview(item);
    if (bmpPreviewBinaryData && bmpPreviewBinaryData.length > 0) {
      bmpPreview = uint8ArrayToHexString2(bmpPreviewBinaryData);
    }
    let entities = this.convertEntities(obj, commonAttrs.handle);
    if (!entities || entities.length == 0) {
      entities = [];
      const entities_ptr = libredwg.dwg_dynapi_entity_value(item, "entities").data;
      if (entities_ptr) {
        const object_ref_ptr_array = libredwg.dwg_ptr_to_object_ref_ptr_array(
          entities_ptr,
          num_owned
        );
        const converter = this.entityConverter;
        for (let index = 0; index < num_owned; index++) {
          const object = libredwg.dwg_ref_get_object(
            object_ref_ptr_array[index]
          );
          const entity = converter.convert(object);
          if (entity) {
            entity.ownerBlockRecordSoftId = commonAttrs.handle;
            entities.push(entity);
          }
        }
      }
    }
    return {
      ...commonAttrs,
      flags,
      description,
      basePoint,
      layout,
      insertionUnits,
      explodability,
      scalability,
      bmpPreview,
      entities
    };
  }
  convertEntities(obj, ownerHandle) {
    const libredwg = this.libredwg;
    const converter = this.entityConverter;
    const entities = [];
    let next = libredwg.get_first_owned_entity(obj);
    while (next) {
      const entity = converter.convert(next);
      if (entity) {
        entity.ownerBlockRecordSoftId = ownerHandle;
        entities.push(entity);
      }
      next = libredwg.get_next_owned_entity(obj, next);
    }
    return entities;
  }
  convertDimStyle(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const DIMTOL = libredwg.dwg_dynapi_entity_value(item, "DIMTOL").data;
    const DIMLIM = libredwg.dwg_dynapi_entity_value(item, "DIMLIM").data;
    const DIMTIH = libredwg.dwg_dynapi_entity_value(item, "DIMTIH").data;
    const DIMTOH = libredwg.dwg_dynapi_entity_value(item, "DIMTOH").data;
    const DIMSE1 = libredwg.dwg_dynapi_entity_value(item, "DIMSE1").data;
    const DIMSE2 = libredwg.dwg_dynapi_entity_value(item, "DIMSE2").data;
    const DIMALT = libredwg.dwg_dynapi_entity_value(item, "DIMALT").data;
    const DIMTOFL = libredwg.dwg_dynapi_entity_value(item, "DIMTOFL").data;
    const DIMSAH = libredwg.dwg_dynapi_entity_value(item, "DIMSAH").data;
    const DIMTIX = libredwg.dwg_dynapi_entity_value(item, "DIMTIX").data;
    const DIMSOXD = libredwg.dwg_dynapi_entity_value(item, "DIMSOXD").data;
    const DIMALTD = libredwg.dwg_dynapi_entity_value(item, "DIMALTD").data;
    const DIMZIN = libredwg.dwg_dynapi_entity_value(item, "DIMZIN").data;
    const DIMSD1 = libredwg.dwg_dynapi_entity_value(item, "DIMSD1").data;
    const DIMSD2 = libredwg.dwg_dynapi_entity_value(item, "DIMSD2").data;
    const DIMTOLJ = libredwg.dwg_dynapi_entity_value(item, "DIMTOLJ").data;
    const DIMJUST = libredwg.dwg_dynapi_entity_value(item, "DIMJUST").data;
    const DIMFIT = libredwg.dwg_dynapi_entity_value(item, "DIMFIT").data;
    const DIMUPT = libredwg.dwg_dynapi_entity_value(item, "DIMUPT").data;
    const DIMTZIN = libredwg.dwg_dynapi_entity_value(item, "DIMTZIN").data;
    const DIMALTZ = libredwg.dwg_dynapi_entity_value(item, "DIMALTZ").data;
    const DIMALTTZ = libredwg.dwg_dynapi_entity_value(item, "DIMALTTZ").data;
    const DIMTAD = libredwg.dwg_dynapi_entity_value(item, "DIMTAD").data;
    const DIMUNIT = libredwg.dwg_dynapi_entity_value(item, "DIMUNIT").data;
    const DIMAUNIT = libredwg.dwg_dynapi_entity_value(item, "DIMAUNIT").data;
    const DIMDEC = libredwg.dwg_dynapi_entity_value(item, "DIMDEC").data;
    const DIMTDEC = libredwg.dwg_dynapi_entity_value(item, "DIMTDEC").data;
    const DIMALTU = libredwg.dwg_dynapi_entity_value(item, "DIMALTU").data;
    const DIMALTTD = libredwg.dwg_dynapi_entity_value(item, "DIMALTTD").data;
    const DIMSCALE = libredwg.dwg_dynapi_entity_value(item, "DIMSCALE").data;
    const DIMASZ = libredwg.dwg_dynapi_entity_value(item, "DIMASZ").data;
    const DIMEXO = libredwg.dwg_dynapi_entity_value(item, "DIMEXO").data;
    const DIMDLI = libredwg.dwg_dynapi_entity_value(item, "DIMDLI").data;
    const DIMEXE = libredwg.dwg_dynapi_entity_value(item, "DIMEXE").data;
    const DIMRND = libredwg.dwg_dynapi_entity_value(item, "DIMRND").data;
    const DIMDLE = libredwg.dwg_dynapi_entity_value(item, "DIMDLE").data;
    const DIMTP = libredwg.dwg_dynapi_entity_value(item, "DIMTP").data;
    const DIMTM = libredwg.dwg_dynapi_entity_value(item, "DIMTM").data;
    const DIMFXL = libredwg.dwg_dynapi_entity_value(item, "DIMFXL").data;
    const DIMJOGANG = libredwg.dwg_dynapi_entity_value(item, "DIMJOGANG").data;
    const DIMTFILL = libredwg.dwg_dynapi_entity_value(item, "DIMTFILL").data;
    const DIMTFILLCLR = libredwg.dwg_dynapi_entity_value(item, "DIMTFILLCLR").data;
    const DIMAZIN = libredwg.dwg_dynapi_entity_value(item, "DIMAZIN").data;
    const DIMARCSYM = libredwg.dwg_dynapi_entity_value(item, "DIMARCSYM").data;
    const DIMTXT = libredwg.dwg_dynapi_entity_value(item, "DIMTXT").data;
    const DIMCEN = libredwg.dwg_dynapi_entity_value(item, "DIMCEN").data;
    const DIMTSZ = libredwg.dwg_dynapi_entity_value(item, "DIMTSZ").data;
    const DIMALTF = libredwg.dwg_dynapi_entity_value(item, "DIMALTF").data;
    const DIMLFAC = libredwg.dwg_dynapi_entity_value(item, "DIMLFAC").data;
    const DIMTVP = libredwg.dwg_dynapi_entity_value(item, "DIMTVP").data;
    const DIMTFAC = libredwg.dwg_dynapi_entity_value(item, "DIMTFAC").data;
    const DIMGAP = libredwg.dwg_dynapi_entity_value(item, "DIMGAP").data;
    const DIMPOST = libredwg.dwg_dynapi_entity_value(item, "DIMPOST").data;
    const DIMAPOST = libredwg.dwg_dynapi_entity_value(item, "DIMAPOST").data;
    const DIMBLK_T = libredwg.dwg_dynapi_entity_value(item, "DIMBLK_T").data;
    const DIMBLK1_T = libredwg.dwg_dynapi_entity_value(item, "DIMBLK1_T").data;
    const DIMBLK2_T = libredwg.dwg_dynapi_entity_value(item, "DIMBLK2_T").data;
    const DIMALTRND = libredwg.dwg_dynapi_entity_value(item, "DIMALTRND").data;
    const DIMCLRD_N = libredwg.dwg_dynapi_entity_value(item, "DIMCLRD_N").data;
    const DIMCLRE_N = libredwg.dwg_dynapi_entity_value(item, "DIMCLRE_N").data;
    const DIMCLRT_N = libredwg.dwg_dynapi_entity_value(item, "DIMCLRT_N").data;
    const DIMCLRD = libredwg.dwg_dynapi_entity_value(item, "DIMCLRD").data;
    const DIMCLRE = libredwg.dwg_dynapi_entity_value(item, "DIMCLRE").data;
    const DIMCLRT = libredwg.dwg_dynapi_entity_value(item, "DIMCLRT").data;
    const DIMADEC = libredwg.dwg_dynapi_entity_value(item, "DIMADEC").data;
    const DIMFRAC = libredwg.dwg_dynapi_entity_value(item, "DIMFRAC").data;
    const DIMLUNIT = libredwg.dwg_dynapi_entity_value(item, "DIMLUNIT").data;
    const DIMDSEP = libredwg.dwg_dynapi_entity_value(item, "DIMDSEP").data;
    const DIMTMOVE = libredwg.dwg_dynapi_entity_value(item, "DIMTMOVE").data;
    const DIMATFIT = libredwg.dwg_dynapi_entity_value(item, "DIMATFIT").data;
    const DIMFXLON = libredwg.dwg_dynapi_entity_value(item, "DIMFXLON").data;
    const DIMTXTDIRECTION = libredwg.dwg_dynapi_entity_value(
      item,
      "DIMTXTDIRECTION"
    ).data;
    const DIMALTMZF = libredwg.dwg_dynapi_entity_value(item, "DIMALTMZF").data;
    const DIMALTMZS = libredwg.dwg_dynapi_entity_value(item, "DIMALTMZS").data;
    const DIMMZF = libredwg.dwg_dynapi_entity_value(item, "DIMMZF").data;
    const DIMMZS = libredwg.dwg_dynapi_entity_value(item, "DIMMZS").data;
    const DIMLWD = libredwg.dwg_dynapi_entity_value(item, "DIMLWD").data;
    const DIMLWE = libredwg.dwg_dynapi_entity_value(item, "DIMLWE").data;
    const DIMTXSTY_Ptr = libredwg.dwg_dynapi_entity_value(item, "DIMTXSTY").data;
    const DIMTXSTY = libredwg.dwg_ref_get_absref(DIMTXSTY_Ptr);
    const DIMLDRBLK_Ptr = libredwg.dwg_dynapi_entity_value(item, "DIMLDRBLK").data;
    const DIMLDRBLK = libredwg.dwg_ref_get_absref(DIMLDRBLK_Ptr);
    return {
      ...commonAttrs,
      DIMPOST,
      DIMAPOST,
      DIMBLK: DIMBLK_T,
      DIMBLK1: DIMBLK1_T,
      DIMBLK2: DIMBLK2_T,
      DIMSCALE,
      DIMASZ,
      DIMEXO,
      DIMDLI,
      DIMEXE,
      DIMRND,
      DIMDLE,
      DIMTP,
      DIMTM,
      DIMTXT,
      DIMCEN,
      DIMTSZ,
      DIMALTF,
      DIMLFAC,
      DIMTVP,
      DIMTFAC,
      DIMGAP,
      DIMALTRND,
      DIMTOL,
      DIMLIM,
      DIMTIH,
      DIMTOH,
      DIMSE1,
      DIMSE2,
      DIMTAD,
      DIMZIN,
      DIMAZIN,
      DIMALT,
      DIMALTD,
      DIMTOFL,
      DIMSAH,
      DIMTIX,
      DIMSOXD,
      DIMCLRD,
      DIMCLRE,
      DIMCLRT,
      DIMADEC,
      DIMUNIT,
      DIMDEC,
      DIMTDEC,
      DIMALTU,
      DIMALTTD,
      DIMAUNIT,
      DIMFRAC,
      DIMLUNIT,
      DIMDSEP: String.fromCharCode(DIMDSEP),
      DIMTMOVE,
      DIMJUST,
      DIMSD1,
      DIMSD2,
      DIMTOLJ,
      DIMTZIN,
      DIMALTZ,
      DIMALTTZ,
      DIMFIT,
      DIMUPT,
      DIMATFIT,
      DIMTXSTY,
      DIMLDRBLK,
      DIMLWD,
      DIMLWE,
      DIMFXL,
      DIMJOGANG,
      DIMTFILL,
      DIMTFILLCLR,
      DIMARCSYM,
      DIMCLRD_N,
      DIMCLRE_N,
      DIMCLRT_N,
      DIMFXLON,
      DIMTXTDIRECTION,
      DIMALTMZF,
      DIMALTMZS,
      DIMMZF,
      DIMMZS
    };
  }
  convertLayer(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const flag = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    const frozen = libredwg.dwg_dynapi_entity_value(item, "frozen").data;
    const off = libredwg.dwg_dynapi_entity_value(item, "off").data;
    const frozenInNew = libredwg.dwg_dynapi_entity_value(item, "frozen_in_new").data;
    const locked = libredwg.dwg_dynapi_entity_value(item, "plotflockedlag").data;
    const plotFlag = libredwg.dwg_dynapi_entity_value(item, "plotflag").data;
    const linewt = libredwg.dwg_dynapi_entity_value(item, "linewt").data;
    const color = libredwg.dwg_dynapi_entity_value(item, "color").data;
    const ltypeRef = libredwg.dwg_dynapi_entity_value(item, "ltype").data;
    let ltypeName = "Continuous";
    if (ltypeRef) {
      try {
        ltypeName = libredwg.dwg_ref_get_object_name(ltypeRef);
      } catch {
      }
    }
    const method = color.method;
    let colorIndex = 256;
    let rgbColor = 16777215;
    if (method === 195 || (color.rgb >>> 24 & 255) === 195) {
      colorIndex = color.rgb & 255;
    } else if (method == 194 || (color.rgb >>> 24 & 255) === 194) {
      rgbColor = color.rgb & 16777215;
    } else if (color.index >= 1 && color.index <= 255) {
      colorIndex = color.index;
    }
    return {
      ...commonAttrs,
      standardFlag: flag,
      colorIndex,
      color: rgbColor,
      colorName: color.name,
      transparency: color.alpha,
      lineType: ltypeName,
      frozen: frozen != 0,
      off: off != 0,
      frozenInNew: frozenInNew != 0,
      locked: locked != 0,
      plotFlag,
      lineweight: linewt,
      plotStyleNameObjectId: "",
      materialObjectId: ""
    };
  }
  convertLineType(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const flag = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    const description = libredwg.dwg_dynapi_entity_value(item, "description").data;
    const numDashes = libredwg.dwg_dynapi_entity_value(item, "numdashes").data;
    const patternLen = libredwg.dwg_dynapi_entity_value(item, "pattern_len").data;
    const dashes = libredwg.dwg_dynapi_entity_value(item, "dashes").data;
    const dashArray = dashes ? libredwg.dwg_ptr_to_ltype_dash_array(dashes, numDashes) : [];
    return {
      ...commonAttrs,
      description,
      standardFlag: flag,
      numberOfLineTypes: numDashes,
      totalPatternLength: patternLen,
      pattern: this.convertLineTypePattern(dashArray)
    };
  }
  convertLineTypePattern(dashes) {
    const patterns = [];
    dashes.forEach((dash) => {
      patterns.push({
        elementLength: dash.length || 0,
        elementTypeFlag: dash.complex_shapecode,
        shapeNumber: dash.shape_flag,
        // TODO: convert style handle to style object id
        // styleObjectId: dash.style,
        scale: dash.scale,
        rotation: dash.rotation,
        offsetX: dash.x_offset,
        offsetY: dash.y_offset,
        text: dash.text
      });
    });
    return patterns;
  }
  convertStyle(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const standardFlag = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    const widthFactor = libredwg.dwg_dynapi_entity_value(item, "width_factor").data;
    const obliqueAngle = libredwg.dwg_dynapi_entity_value(item, "oblique_angle").data;
    const textGenerationFlag = libredwg.dwg_dynapi_entity_value(
      item,
      "generation"
    ).data;
    const lastHeight = libredwg.dwg_dynapi_entity_value(item, "last_height").data;
    const font = libredwg.dwg_dynapi_entity_value(item, "font_file").data;
    const bigFont = libredwg.dwg_dynapi_entity_value(item, "bigfont_file").data;
    return {
      ...commonAttrs,
      standardFlag,
      fixedTextHeight: 0,
      // TODO: Set the correct value
      widthFactor,
      obliqueAngle,
      textGenerationFlag,
      lastHeight,
      font,
      bigFont
    };
  }
  convertViewport(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonTableEntryAttrs(item, obj);
    const standardFlag = libredwg.dwg_dynapi_entity_value(item, "flag").data;
    const viewHeight = libredwg.dwg_dynapi_entity_value(item, "VIEWSIZE").data;
    const aspectRatio = libredwg.dwg_dynapi_entity_value(item, "aspect_ratio").data;
    const center = libredwg.dwg_dynapi_entity_value(item, "VIEWCTR").data;
    const viewTarget = libredwg.dwg_dynapi_entity_value(item, "view_target").data;
    const viewDirectionFromTarget = libredwg.dwg_dynapi_entity_value(
      item,
      "VIEWDIR"
    ).data;
    const viewTwistAngle = libredwg.dwg_dynapi_entity_value(item, "view_twist").data;
    const lensLength = libredwg.dwg_dynapi_entity_value(item, "lens_length").data;
    const frontClippingPlane = libredwg.dwg_dynapi_entity_value(
      item,
      "front_clip_z"
    ).data;
    const backClippingPlane = libredwg.dwg_dynapi_entity_value(
      item,
      "back_clip_z"
    ).data;
    const viewMode = libredwg.dwg_dynapi_entity_value(item, "VIEWMODE").data;
    const renderMode = libredwg.dwg_dynapi_entity_value(item, "render_mode").data;
    const isDefaultLightingOn = libredwg.dwg_dynapi_entity_value(item, "use_default_lights").data != 0;
    const defaultLightningType = libredwg.dwg_dynapi_entity_value(
      item,
      "default_lightning_type"
    ).data;
    const brightness = libredwg.dwg_dynapi_entity_value(item, "brightness").data;
    const contrast = libredwg.dwg_dynapi_entity_value(item, "contrast").data;
    const ambient_color = libredwg.dwg_dynapi_entity_value(
      item,
      "ambient_color"
    ).data;
    const lowerLeftCorner = libredwg.dwg_dynapi_entity_value(item, "lower_left").data;
    const upperRightCorner = libredwg.dwg_dynapi_entity_value(
      item,
      "upper_right"
    ).data;
    const circleSides = libredwg.dwg_dynapi_entity_value(item, "circle_zoom").data;
    const ucsIconSetting = libredwg.dwg_dynapi_entity_value(item, "UCSICON").data;
    const gridSpacing = libredwg.dwg_dynapi_entity_value(item, "GRIDUNIT").data;
    const snapRotationAngle = libredwg.dwg_dynapi_entity_value(item, "SNAPANG").data;
    const snapBasePoint = libredwg.dwg_dynapi_entity_value(item, "SNAPBASE").data;
    const snapSpacing = libredwg.dwg_dynapi_entity_value(item, "SNAPUNIT").data;
    const ucsOrigin = libredwg.dwg_dynapi_entity_value(item, "ucsorg").data;
    const ucsXAxis = libredwg.dwg_dynapi_entity_value(item, "ucsxdir").data;
    const ucsYAxis = libredwg.dwg_dynapi_entity_value(item, "ucsydir").data;
    const elevation = libredwg.dwg_dynapi_entity_value(item, "ucs_elevation").data;
    const majorGridLines = libredwg.dwg_dynapi_entity_value(item, "grid_major").data;
    const background = libredwg.dwg_dynapi_entity_value(item, "background").data;
    const backgroundObjectId = background ? idToString(libredwg.dwg_ref_get_absref(background)) : void 0;
    const visualstyle = libredwg.dwg_dynapi_entity_value(item, "visualstyle").data;
    const visualStyleObjectId = visualstyle ? idToString(libredwg.dwg_ref_get_absref(visualstyle)) : void 0;
    return {
      ...commonAttrs,
      standardFlag,
      lowerLeftCorner,
      upperRightCorner,
      center,
      snapBasePoint,
      snapSpacing,
      gridSpacing,
      viewDirectionFromTarget,
      viewTarget,
      lensLength,
      frontClippingPlane,
      backClippingPlane,
      viewHeight,
      aspectRatio,
      snapRotationAngle,
      viewTwistAngle,
      circleSides,
      frozenLayers: [],
      // TODO: Set the correct value
      styleSheet: "",
      // TODO: Set the correct value
      renderMode,
      viewMode,
      ucsIconSetting,
      ucsOrigin,
      ucsXAxis,
      ucsYAxis,
      orthographicType: 0,
      // TODO: Set the correct value
      elevation,
      shadePlotSetting: 0,
      // TODO: Set the correct value
      majorGridLines,
      backgroundObjectId,
      // shadePlotObjectId: undefined,
      visualStyleObjectId,
      isDefaultLightingOn,
      defaultLightingType: defaultLightningType,
      brightness,
      contrast,
      // TODO: Not sure whether 'index' or 'rgb' should be used
      ambientColor: ambient_color.index
    };
  }
  getCommonTableEntryAttrs(tio, obj) {
    const libredwg = this.libredwg;
    const object_tio = libredwg.dwg_object_get_tio(obj);
    const ownerhandle = libredwg.dwg_object_object_get_ownerhandle_object(object_tio);
    const handle = libredwg.dwg_object_get_handle_object(obj);
    return {
      handle: idToString(handle.value),
      ownerHandle: idToString(ownerhandle.absolute_ref),
      name: libredwg.dwg_dynapi_entity_value(tio, "name").data
    };
  }
  convertDictionary(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonObjectAttrs(obj);
    const isHardOwner = libredwg.dwg_dynapi_entity_value(item, "is_hardowner").data;
    const cloningFlag = libredwg.dwg_dynapi_entity_value(item, "cloning").data;
    const numitems = libredwg.dwg_dynapi_entity_value(item, "numitems").data;
    const itemhandles_ptr = libredwg.dwg_dynapi_entity_value(
      item,
      "itemhandles"
    ).data;
    const itemhandles = libredwg.dwg_ptr_to_object_ref_array(
      itemhandles_ptr,
      numitems
    );
    const texts = libredwg.dwg_object_dictionary_get_texts(obj);
    const entries = {};
    itemhandles.forEach(
      (handle, index) => entries[texts[index]] = idToString(handle.absolute_ref)
    );
    return {
      ...commonAttrs,
      isHardOwner: !!isHardOwner,
      cloningFlag,
      entries
    };
  }
  convertImageDef(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonObjectAttrs(obj);
    const size = libredwg.dwg_dynapi_entity_value(item, "image_size").data;
    const fileName = libredwg.dwg_dynapi_entity_value(item, "file_path").data;
    const isLoaded = libredwg.dwg_dynapi_entity_value(item, "is_loaded").data;
    const sizeOfOnePixel = libredwg.dwg_dynapi_entity_value(item, "pixel_size").data;
    const resolutionUnits = libredwg.dwg_dynapi_entity_value(item, "resunits").data;
    return {
      ...commonAttrs,
      fileName,
      size,
      sizeOfOnePixel,
      isLoaded,
      resolutionUnits
    };
  }
  convertLayout(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonObjectAttrs(obj);
    const layoutName = libredwg.dwg_dynapi_entity_value(item, "layout_name").data;
    const tabOrder = libredwg.dwg_dynapi_entity_value(item, "tab_order").data;
    const controlFlag = libredwg.dwg_dynapi_entity_value(item, "layout_flags").data;
    const insertionPoint = libredwg.dwg_dynapi_entity_value(item, "INSBASE").data;
    const minLimit = libredwg.dwg_dynapi_entity_value(item, "LIMMIN").data;
    const maxLimit = libredwg.dwg_dynapi_entity_value(item, "LIMMAX").data;
    const ucsOrigin = libredwg.dwg_dynapi_entity_value(item, "UCSORG").data;
    const ucsXAxis = libredwg.dwg_dynapi_entity_value(item, "UCSXDIR").data;
    const ucsYAxis = libredwg.dwg_dynapi_entity_value(item, "UCSYDIR").data;
    const orthographicType = libredwg.dwg_dynapi_entity_value(
      item,
      "UCSORTHOVIEW"
    ).data;
    const minExtent = libredwg.dwg_dynapi_entity_value(item, "EXTMIN").data;
    const maxExtent = libredwg.dwg_dynapi_entity_value(item, "EXTMAX").data;
    const elevation = libredwg.dwg_dynapi_entity_value(item, "ucs_elevation").data;
    const block_header_ref = libredwg.dwg_dynapi_entity_value(
      item,
      "block_header"
    ).data;
    const paperSpaceTableId = idToString(
      libredwg.dwg_ref_get_absref(block_header_ref)
    );
    const active_viewport_ref = libredwg.dwg_dynapi_entity_value(
      item,
      "active_viewport"
    ).data;
    const viewportId = idToString(
      libredwg.dwg_ref_get_absref(active_viewport_ref)
    );
    const named_ucs_ref = libredwg.dwg_dynapi_entity_value(item, "named_ucs").data;
    const namedUcsId = named_ucs_ref ? idToString(libredwg.dwg_ref_get_absref(named_ucs_ref)) : void 0;
    return {
      ...commonAttrs,
      layoutName,
      controlFlag,
      tabOrder,
      minLimit,
      maxLimit,
      insertionPoint,
      minExtent,
      maxExtent,
      elevation,
      ucsOrigin,
      ucsXAxis,
      ucsYAxis,
      orthographicType,
      paperSpaceTableId,
      viewportId,
      namedUcsId,
      // orthographicUcsId?: string;
      shadePlotId: ""
      // TODO: Set the correct value
    };
  }
  convertSpatialFilter(item, obj) {
    const libredwg = this.libredwg;
    const commonAttrs = this.getCommonObjectAttrs(obj);
    const origin = libredwg.dwg_dynapi_entity_value(item, "origin").data;
    const numberOfPointsOnClipBoundary = libredwg.dwg_dynapi_entity_value(
      item,
      "num_clip_verts"
    ).data;
    const clip_verts_ptr = libredwg.dwg_dynapi_entity_value(item, "clip_verts").data;
    const vertices = libredwg.dwg_ptr_to_point2d_array(
      clip_verts_ptr,
      numberOfPointsOnClipBoundary
    );
    const extrusionDirection = libredwg.dwg_dynapi_entity_value(
      item,
      "extrusion"
    ).data;
    const clipBoundaryVisible = libredwg.dwg_dynapi_entity_value(
      item,
      "display_boundary_on"
    ).data;
    const frontClippingPlaneFlag = libredwg.dwg_dynapi_entity_value(
      item,
      "front_clip_on"
    ).data;
    const frontClippingPlaneDistance = libredwg.dwg_dynapi_entity_value(
      item,
      "front_clip_z"
    ).data;
    const backClippingPlaneFlag = libredwg.dwg_dynapi_entity_value(
      item,
      "back_clip_on"
    ).data;
    const backClippingPlaneDistance = libredwg.dwg_dynapi_entity_value(
      item,
      "back_clip_z"
    ).data;
    const transform_ptr = libredwg.dwg_dynapi_entity_value(item, "transform").data;
    const matrix = libredwg.dwg_ptr_to_double_array(transform_ptr, 12);
    const inverse_transform_ptr = libredwg.dwg_dynapi_entity_value(
      item,
      "inverse_transform"
    ).data;
    const invertBlockMatrix = libredwg.dwg_ptr_to_double_array(
      inverse_transform_ptr,
      12
    );
    return {
      ...commonAttrs,
      origin,
      numberOfPointsOnClipBoundary,
      vertices,
      extrusionDirection,
      clipBoundaryVisible: !!clipBoundaryVisible,
      frontClippingPlaneFlag: !!frontClippingPlaneFlag,
      frontClippingPlaneDistance,
      backClippingPlaneFlag: !!backClippingPlaneFlag,
      backClippingPlaneDistance,
      matrix,
      invertBlockMatrix
    };
  }
  getCommonObjectAttrs(obj) {
    const libredwg = this.libredwg;
    const object_tio = libredwg.dwg_object_get_tio(obj);
    const ownerhandle = libredwg.dwg_object_object_get_ownerhandle_object(object_tio);
    const handle = libredwg.dwg_object_get_handle_object(obj);
    return {
      handle: idToString(handle.value),
      ownerHandle: idToString(ownerhandle.absolute_ref)
    };
  }
}
class Box2D {
  constructor() {
    __publicField(this, "min");
    __publicField(this, "max");
    __publicField(this, "valid");
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
    this.valid = false;
  }
  /**
   * Expands the bounding box to include a given point.
   *
   * @param point - The point to include in the bounding box.
   * @returns This bounding box after expansion.
   */
  expandByPoint(point) {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.valid = true;
    return this;
  }
  /**
   * Applies a scaling and translation transformation to this bounding box.
   *
   * @param scale - The scaling factors in x and y directions.
   * @param translation - The translation offsets in x and y directions.
   * @returns This bounding box after transformation.
   */
  transform(scale, translation) {
    const corners = this.getCorners().map((p) => ({
      x: p.x * scale.x + translation.x,
      y: p.y * scale.y + translation.y
    }));
    this.reset();
    for (const pt of corners) {
      this.expandByPoint(pt);
    }
    return this;
  }
  /**
   * Applies a rotation around a specific point to this bounding box.
   *
   * @param angleInRad - The angle of rotation in radians.
   * @param point - The center of rotation.
   * @returns This bounding box after rotation.
   */
  rotate(angleInRad, point) {
    const cos = Math.cos(angleInRad);
    const sin = Math.sin(angleInRad);
    const corners = this.getCorners().map((p) => {
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      return {
        x: point.x + dx * cos - dy * sin,
        y: point.y + dx * sin + dy * cos
      };
    });
    this.reset();
    for (const pt of corners) {
      this.expandByPoint(pt);
    }
    return this;
  }
  /**
   * Creates a deep copy of this bounding box.
   *
   * @returns A new instance of Box2D with the same properties.
   */
  clone() {
    const box = new Box2D();
    box.min = { x: this.min.x, y: this.min.y };
    box.max = { x: this.max.x, y: this.max.y };
    box.valid = this.valid;
    return box;
  }
  /**
   * Resets this bounding box to its initial unbounded state.
   */
  reset() {
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
    this.valid = false;
  }
  /**
   * Retrieves the four corner points of the bounding box.
   *
   * @returns An array of corner points in the order:
   * bottom-left, top-left, bottom-right, top-right.
   */
  getCorners() {
    return [
      { x: this.min.x, y: this.min.y },
      { x: this.min.x, y: this.max.y },
      { x: this.max.x, y: this.min.y },
      { x: this.max.x, y: this.max.y }
    ];
  }
}
function evaluateBSpline(t, degree, points, knots, weights) {
  const n = points.length;
  if (n === 0) throw new Error("points must not be empty");
  const d = points[0].length;
  if (t < 0 || t > 1) {
    throw new Error(`t out of bounds [0,1]: ${t}`);
  }
  if (degree < 1) {
    throw new Error("degree must be at least 1 (linear)");
  }
  if (degree > n - 1) {
    throw new Error("degree must be less than or equal to point count - 1");
  }
  const weightsSafe = weights ?? new Array(n).fill(1);
  const knotsSafe = knots ?? (() => {
    const result2 = [];
    for (let i = 0; i < n + degree + 1; i++) {
      result2.push(i);
    }
    return result2;
  })();
  if (knotsSafe.length !== n + degree + 1) {
    throw new Error("bad knot vector length");
  }
  const domain = [degree, knotsSafe.length - 1 - degree];
  const low = knotsSafe[domain[0]];
  const high = knotsSafe[domain[1]];
  t = t * (high - low) + low;
  t = Math.max(t, low);
  t = Math.min(t, high);
  let s = domain[0];
  for (; s < domain[1]; s++) {
    if (t >= knotsSafe[s] && t <= knotsSafe[s + 1]) {
      break;
    }
  }
  const v = new Array(n);
  for (let i = 0; i < n; i++) {
    v[i] = new Array(d + 1);
    for (let j = 0; j < d; j++) {
      v[i][j] = points[i][j] * weightsSafe[i];
    }
    v[i][d] = weightsSafe[i];
  }
  for (let l = 1; l <= degree + 1; l++) {
    for (let i = s; i > s - degree - 1 + l; i--) {
      const denom = knotsSafe[i + degree + 1 - l] - knotsSafe[i];
      const alpha = denom === 0 ? 0 : (t - knotsSafe[i]) / denom;
      for (let j = 0; j < d + 1; j++) {
        v[i][j] = (1 - alpha) * v[i - 1][j] + alpha * v[i][j];
      }
    }
  }
  const result = new Array(d);
  for (let i = 0; i < d; i++) {
    result[i] = round10(v[s][i] / v[s][d], -9);
  }
  return result;
}
function round10(value, exp) {
  if (isNaN(value) || !Number.isInteger(exp)) {
    return NaN;
  }
  const [base, exponent = "0"] = value.toString().split("e");
  const shifted = Math.round(Number(`${base}e${+exponent - exp}`));
  const [shiftedBase, shiftedExp = "0"] = shifted.toString().split("e");
  return Number(`${shiftedBase}e${+shiftedExp + exp}`);
}
const _colorKeywords = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
const AUTO_CAD_COLOR_INDEX = [
  0,
  16711680,
  16776960,
  65280,
  65535,
  255,
  16711935,
  16777215,
  8421504,
  12632256,
  16711680,
  16744319,
  13369344,
  13395558,
  10027008,
  10046540,
  8323072,
  8339263,
  4980736,
  4990502,
  16727808,
  16752511,
  13382400,
  13401958,
  10036736,
  10051404,
  8331008,
  8343359,
  4985600,
  4992806,
  16744192,
  16760703,
  13395456,
  13408614,
  10046464,
  10056268,
  8339200,
  8347455,
  4990464,
  4995366,
  16760576,
  16768895,
  13408512,
  13415014,
  10056192,
  10061132,
  8347392,
  8351551,
  4995328,
  4997670,
  16776960,
  16777087,
  13421568,
  13421670,
  10000384,
  10000460,
  8355584,
  8355647,
  5000192,
  5000230,
  12582656,
  14679935,
  10079232,
  11717734,
  7510016,
  8755276,
  6258432,
  7307071,
  3755008,
  4344870,
  8388352,
  12582783,
  6736896,
  10079334,
  5019648,
  7510092,
  4161280,
  6258495,
  2509824,
  3755046,
  4194048,
  10485631,
  3394560,
  8375398,
  2529280,
  6264908,
  2064128,
  5209919,
  1264640,
  3099686,
  65280,
  8388479,
  52224,
  6736998,
  38912,
  5019724,
  32512,
  4161343,
  19456,
  2509862,
  65343,
  8388511,
  52275,
  6737023,
  38950,
  5019743,
  32543,
  4161359,
  19475,
  2509871,
  65407,
  8388543,
  52326,
  6737049,
  38988,
  5019762,
  32575,
  4161375,
  19494,
  2509881,
  65471,
  8388575,
  52377,
  6737074,
  39026,
  5019781,
  32607,
  4161391,
  19513,
  2509890,
  65535,
  8388607,
  52428,
  6737100,
  39064,
  5019800,
  32639,
  4161407,
  19532,
  2509900,
  49151,
  8380415,
  39372,
  6730444,
  29336,
  5014936,
  24447,
  4157311,
  14668,
  2507340,
  32767,
  8372223,
  26316,
  6724044,
  19608,
  5010072,
  16255,
  4153215,
  9804,
  2505036,
  16383,
  8364031,
  13260,
  6717388,
  9880,
  5005208,
  8063,
  4149119,
  4940,
  2502476,
  255,
  8355839,
  204,
  6710988,
  152,
  5000344,
  127,
  4145023,
  76,
  2500172,
  4129023,
  10452991,
  3342540,
  8349388,
  2490520,
  6245528,
  2031743,
  5193599,
  1245260,
  3089996,
  8323327,
  12550143,
  6684876,
  10053324,
  4980888,
  7490712,
  4128895,
  6242175,
  2490444,
  3745356,
  12517631,
  14647295,
  10027212,
  11691724,
  7471256,
  8735896,
  6226047,
  7290751,
  3735628,
  4335180,
  16711935,
  16744447,
  13369548,
  13395660,
  9961624,
  9981080,
  8323199,
  8339327,
  4980812,
  4990540,
  16711871,
  16744415,
  13369497,
  13395634,
  9961586,
  9981061,
  8323167,
  8339311,
  4980793,
  4990530,
  16711807,
  16744383,
  13369446,
  13395609,
  9961548,
  9981042,
  8323135,
  8339295,
  4980774,
  4990521,
  16711743,
  16744351,
  13369395,
  13395583,
  9961510,
  9981023,
  8323103,
  8339279,
  4980755,
  4990511,
  3355443,
  5987163,
  8684676,
  11382189,
  14079702,
  16777215,
  0
];
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
const _Color = class _Color {
  constructor() {
    __publicField(this, "_colorIndex");
    __publicField(this, "_color");
    __publicField(this, "_colorName");
    this._colorIndex = 256;
    this._color = null;
    this._colorName = null;
  }
  get color() {
    return this._color;
  }
  set color(value) {
    if (value == null) {
      this._color = null;
    } else {
      this._color = Math.round(clamp(value, 0, 256 * 256 * 256 - 1));
      this._colorIndex = this.getColorIndexByValue(this._color);
      this._colorName = this.getColorNameByValue(this._color);
    }
  }
  get hexColor() {
    if (this._color && this._color > 0 && this._color <= 16777215) {
      let hexString = this._color.toString(16).toUpperCase();
      while (hexString.length < 6) {
        hexString = "0" + hexString;
      }
      return `0x${hexString}`;
    }
    return "";
  }
  get cssColor() {
    return `rgb(${this.red},${this.green},${this.blue})`;
  }
  get red() {
    return this.color != null ? this.color >> 16 & 255 : null;
  }
  get green() {
    return this.color != null ? this.color >> 8 & 255 : null;
  }
  get blue() {
    return this.color != null ? this.color & 255 : null;
  }
  /**
   * AutoCAD color index value. The index value will be in the range 0 to 256. 0 and 256 are special values.
   * If value less than 0 is set, 0 will be used. If value greater than 256 is set, 256 will be used.
   * - 0 indicates that the entity uses the color of the BlockReference that's displaying it. If the entity
   * is not displayed through a block reference (for example, it is directly owned by the model space
   * block table record) and its color is 0, then it will display as though its color were 7.
   * - 256 indicates that the entity uses the color specified in the layer table record it references.
   */
  get colorIndex() {
    return this._colorIndex;
  }
  set colorIndex(value) {
    if (value == null) {
      this._colorIndex = null;
    } else {
      this._colorIndex = clamp(value, 0, 256);
      this._color = AUTO_CAD_COLOR_INDEX[value];
      this._colorName = this.getColorNameByValue(this._color);
    }
  }
  get colorName() {
    return this._colorName;
  }
  set colorName(value) {
    if (value) {
      const color = _colorKeywords[value.toLowerCase()];
      if (color !== void 0) {
        this._colorName = value;
        this._color = color;
        this._colorIndex = this.getColorIndexByValue(this._color);
      } else {
        console.warn("Unknown color: " + value);
      }
    } else {
      this._colorName = null;
    }
  }
  get hasColorName() {
    return this._colorName == null;
  }
  get hasColorIndex() {
    return this._colorIndex == null;
  }
  get isByLayer() {
    return this.colorIndex == 256;
  }
  setByLayer() {
    this.colorIndex = 256;
    return this;
  }
  get isByBlock() {
    return this.colorIndex == 0;
  }
  setByBlock() {
    this.colorIndex = 0;
    return this;
  }
  setScalar(scalar) {
    this.setRGB(scalar, scalar, scalar);
    return this;
  }
  setRGB(r, g, b) {
    const red = Math.round(clamp(r, 0, 255));
    const green = Math.round(clamp(g, 0, 255));
    const blue = Math.round(clamp(b, 0, 255));
    this.color = (red << 16) + (green << 8) + blue;
    return this;
  }
  setColorName(style) {
    const color = _colorKeywords[style.toLowerCase()];
    if (color !== void 0) {
      this.color = color;
    } else {
      console.warn("Unknown color " + style);
    }
    return this;
  }
  clone() {
    const clonedColor = new _Color();
    clonedColor.colorIndex = this.colorIndex;
    clonedColor.color = this.color;
    clonedColor._colorName = this._colorName;
    return this;
  }
  copy(color) {
    this.colorIndex = color.colorIndex;
    this.color = color.color;
    this._colorName = color._colorName;
    return this;
  }
  equals(c) {
    return c.color == this.color && c.colorIndex == this.colorIndex && c._colorName == this._colorName;
  }
  toString() {
    if (this.isByLayer) {
      return "ByLayer";
    } else if (this.isByBlock) {
      return "ByBlock";
    } else if (this.colorName) {
      return this.colorName;
    } else {
      return this.hexColor;
    }
  }
  getColorNameByValue(target) {
    for (const [key, value] of Object.entries(_colorKeywords)) {
      if (value === target) {
        return key;
      }
    }
    return null;
  }
  getColorIndexByValue(target) {
    const length = AUTO_CAD_COLOR_INDEX.length - 1;
    for (let index = 1; index < length; ++index) {
      if (AUTO_CAD_COLOR_INDEX[index] === target) {
        return index;
      }
    }
    return null;
  }
};
__publicField(_Color, "NAMES", _colorKeywords);
let Color = _Color;
class Vector2D {
  constructor(x, y) {
    __publicField(this, "x");
    __publicField(this, "y");
    this.x = x;
    this.y = y;
  }
  add(v) {
    return new Vector2D(this.x + v.x, this.y + v.y);
  }
  sub(v) {
    return new Vector2D(this.x - v.x, this.y - v.y);
  }
  multiply(scalar) {
    return new Vector2D(this.x * scalar, this.y * scalar);
  }
  length() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
  norm() {
    const len = this.length();
    if (len === 0) return new Vector2D(0, 0);
    return new Vector2D(this.x / len, this.y / len);
  }
}
function createPolylineArcPoints(from, to, bulge, resolution = 5) {
  let theta;
  let a;
  let b;
  if (bulge < 0) {
    theta = Math.atan(-bulge) * 4;
    a = new Vector2D(from.x, from.y);
    b = new Vector2D(to.x, to.y);
  } else {
    theta = Math.atan(bulge) * 4;
    a = new Vector2D(to.x, to.y);
    b = new Vector2D(from.x, from.y);
  }
  const ab = b.sub(a);
  const lengthAB = ab.length();
  const c = a.add(ab.multiply(0.5));
  const lengthCD = Math.abs(lengthAB / 2 / Math.tan(theta / 2));
  const normAB = ab.norm();
  const rotated = new Vector2D(
    normAB.x * Math.cos(Math.PI / 2) - normAB.y * Math.sin(Math.PI / 2),
    normAB.y * Math.cos(Math.PI / 2) + normAB.x * Math.sin(Math.PI / 2)
  );
  const d = theta < Math.PI ? c.add(rotated.multiply(-lengthCD)) : c.add(rotated.multiply(lengthCD));
  const startAngle = Math.atan2(b.y - d.y, b.x - d.x) / Math.PI * 180;
  let endAngle = Math.atan2(a.y - d.y, a.x - d.x) / Math.PI * 180;
  if (endAngle < startAngle) {
    endAngle += 360;
  }
  const r = b.sub(d).length();
  const startInter = Math.floor(startAngle / resolution) * resolution + resolution;
  const endInter = Math.ceil(endAngle / resolution) * resolution - resolution;
  const points = [];
  for (let i = startInter; i <= endInter; i += resolution) {
    const angleRad = i / 180 * Math.PI;
    const point = d.add(
      new Vector2D(Math.cos(angleRad) * r, Math.sin(angleRad) * r)
    );
    points.push(point);
  }
  if (bulge < 0) {
    points.reverse();
  }
  return points;
}
function interpolatePolyline(entity, closed = false) {
  let points = [];
  const vertices = entity.vertices.map((v) => {
    return {
      x: v.x,
      y: v.y,
      bulge: v.bulge
    };
  });
  if (closed) {
    vertices.push(vertices[0]);
  }
  for (let i = 0, len = vertices.length; i < len - 1; ++i) {
    const from = vertices[i];
    const to = vertices[i + 1];
    points.push(from);
    if (vertices[i].bulge) {
      points = points.concat(
        createPolylineArcPoints(from, to, entity.vertices[i].bulge)
      );
    }
    if (i === len - 2) {
      points.push(to);
    }
  }
  return points;
}
class SvgConverter {
  constructor() {
    __publicField(this, "blockMap", /* @__PURE__ */ new Map());
  }
  rotate(point, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos
    };
  }
  /**
   * Interpolates a B-spline curve and returns the resulting polyline.
   *
   * @param controlPoints The control points of the B-spline.
   * @param degree The degree of the B-spline.
   * @param knots The knot vector.
   * @param interpolationsPerSplineSegment Number of interpolated points per spline segment.
   * @param weights Optional weight vector for rational B-splines.
   * @returns An array of interpolated 2D points representing the polyline.
   */
  interpolateBSpline(controlPoints, degree, knots, interpolationsPerSplineSegment = 25, weights) {
    const polyline = [];
    const controlPointsForLib = controlPoints.map(
      (p) => [p.x, p.y]
    );
    const segmentTs = [knots[degree]];
    const domain = [
      knots[degree],
      knots[knots.length - 1 - degree]
    ];
    for (let k = degree + 1; k < knots.length - degree; ++k) {
      if (segmentTs[segmentTs.length - 1] !== knots[k]) {
        segmentTs.push(knots[k]);
      }
    }
    for (let i = 1; i < segmentTs.length; ++i) {
      const uMin = segmentTs[i - 1];
      const uMax = segmentTs[i];
      for (let k = 0; k <= interpolationsPerSplineSegment; ++k) {
        const u = k / interpolationsPerSplineSegment * (uMax - uMin) + uMin;
        let t = (u - domain[0]) / (domain[1] - domain[0]);
        t = Math.max(0, Math.min(1, t));
        const p = evaluateBSpline(
          t,
          degree,
          controlPointsForLib,
          knots,
          weights
        );
        polyline.push({ x: p[0], y: p[1] });
      }
    }
    return polyline;
  }
  addFlipXIfApplicable(entity, { bbox, element }) {
    if ("extrusionDirection" in entity && entity.extrusionDirection.z === -1) {
      return {
        bbox: new Box2D().expandByPoint({ x: -bbox.min.x, y: bbox.min.y }).expandByPoint({ x: -bbox.max.x, y: bbox.max.y }),
        element: `<g transform="matrix(-1 0 0 1 0 0)">${element}</g>`
      };
    } else {
      return { bbox, element };
    }
  }
  line(entity) {
    const bbox = new Box2D().expandByPoint({ x: entity.startPoint.x, y: entity.startPoint.y }).expandByPoint({ x: entity.endPoint.x, y: entity.endPoint.y });
    const element = `<line x1="${entity.startPoint.x}" y1="${entity.startPoint.y}" x2="${entity.endPoint.x}" y2="${entity.endPoint.y}" />`;
    return { bbox, element };
  }
  ray(entity) {
    const scale = 1e4;
    const firstPoint = entity.firstPoint;
    const secondPoint = {
      x: firstPoint.x + entity.unitDirection.x * scale,
      y: firstPoint.y + entity.unitDirection.y * scale
    };
    const bbox = new Box2D().expandByPoint(firstPoint).expandByPoint(secondPoint);
    const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
    return { bbox, element };
  }
  xline(entity) {
    const scale = 1e4;
    const firstPoint = {
      x: entity.firstPoint.x - entity.unitDirection.x * scale,
      y: entity.firstPoint.y - entity.unitDirection.y * scale
    };
    const secondPoint = {
      x: entity.firstPoint.x + entity.unitDirection.x * scale,
      y: entity.firstPoint.y + entity.unitDirection.y * scale
    };
    const bbox = new Box2D().expandByPoint(firstPoint).expandByPoint(secondPoint);
    const element = `<line x1="${firstPoint.x}" y1="${firstPoint.y}" x2="${secondPoint.x}" y2="${secondPoint.y}" />`;
    return { bbox, element };
  }
  extractMTextLines(mtext) {
    return mtext.replace(
      /\\U\+([0-9A-Fa-f]{4})/g,
      (_, hex) => String.fromCharCode(parseInt(hex, 16))
    ).replace(/\\P/g, "\n").replace(/\\[LOlo]/g, "").replace(/\\[Ff][^;\\]*?(?:\|[^;\\]*)*;/g, "").replace(/\\[KkCcHhWwTtAa][^;\\]*;?/g, "").replace(/\\[a-zA-Z]+;?/g, "").replace(/%%(d|p|c|%)/gi, "").replace(/\\\\/g, "\\").replace(/\\~/g, " ").replace(/[{}]/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  }
  lines(lines, fontsize, insertionPoint, extentsWidth, anchor = "start") {
    const bbox = new Box2D().expandByPoint({
      x: insertionPoint.x,
      y: insertionPoint.y
    }).expandByPoint({
      x: insertionPoint.x + extentsWidth,
      y: insertionPoint.y - lines.length * fontsize * 1.5
    });
    const texts = lines.map((line, index) => {
      const x = insertionPoint.x;
      const y = insertionPoint.y - index * fontsize * 1.5;
      const transform = `translate(${x},${y}) scale(1,-1) translate(${-x},${-y})`;
      return `<text x="${x}" y="${y}" font-size="${fontsize}" text-anchor="${anchor}" transform="${transform}">${line}</text>`;
    });
    return { bbox, element: texts.join("\n") };
  }
  mtext(entity) {
    const fontsize = entity.textHeight;
    const insertionPoint = entity.insertionPoint;
    const lines = this.extractMTextLines(entity.text);
    const attachmentPoint = entity.attachmentPoint;
    let anchor = "start";
    if (attachmentPoint == DwgAttachmentPoint.BottomCenter || attachmentPoint == DwgAttachmentPoint.MiddleCenter || attachmentPoint == DwgAttachmentPoint.TopCenter) {
      anchor = "middle";
    } else if (attachmentPoint == DwgAttachmentPoint.BottomRight || attachmentPoint == DwgAttachmentPoint.MiddleRight || attachmentPoint == DwgAttachmentPoint.TopRight) {
      anchor = "end";
    }
    return this.lines(
      lines,
      fontsize,
      insertionPoint,
      entity.extentsWidth,
      anchor
    );
  }
  table(entity) {
    const {
      rowCount,
      columnCount,
      rowHeightArr,
      columnWidthArr,
      startPoint,
      cells
    } = entity;
    const originX = startPoint.x;
    const originY = startPoint.y;
    const cellRects = [];
    for (let row = 0, y = originY; row < rowCount; row++) {
      const height = rowHeightArr[row];
      let x = originX;
      for (let col = 0; col < columnCount; col++) {
        const cellIndex = row * columnCount + col;
        const cell = cells[cellIndex];
        const width = columnWidthArr[col];
        cellRects.push({ x, y, width, height, cell, row, col });
        x += width;
      }
      y += height;
    }
    const svgElements = cellRects.map(({ x, y, width, height, cell }) => {
      const lines = [];
      if (cell.topBorderVisibility)
        lines.push(
          `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="black" />`
        );
      if (cell.bottomBorderVisibility)
        lines.push(
          `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" stroke="black" />`
        );
      if (cell.leftBorderVisibility)
        lines.push(
          `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" stroke="black" />`
        );
      if (cell.rightBorderVisibility)
        lines.push(
          `<line x1="${x + width}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="black" />`
        );
      const textX = x + width / 2;
      const textY = y + height / 2 + cell.textHeight / 3;
      const text = `<text x="${textX}" y="${textY}" font-size="${cell.textHeight}" text-anchor="middle" dominant-baseline="middle">${cell.text}</text>`;
      return [...lines, text].join("\n");
    }).join("\n");
    const totalWidth = columnWidthArr.reduce((sum, w) => sum + w, 0);
    const totalHeight = rowHeightArr.reduce((sum, h) => sum + h, 0);
    const bbox = new Box2D().expandByPoint({ x: originX, y: originY }).expandByPoint({ x: originX + totalWidth, y: originY + totalHeight });
    const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="${originX} ${originY} ${totalWidth} ${totalHeight}">
  ${svgElements}
  </svg>
    `.trim();
    return {
      bbox,
      element: svg
    };
  }
  text(entity) {
    const fontsize = entity.textHeight;
    const insertionPoint = entity.startPoint;
    const lines = [entity.text];
    let extentsWidth = entity.endPoint.x - entity.endPoint.x;
    if (entity.halign == 0) {
      extentsWidth = entity.text.length * fontsize + entity.startPoint.x;
    }
    let anchor = "start";
    if (entity.halign == DwgTextHorizontalAlign.CENTER) {
      anchor = "middle";
    } else if (entity.halign == DwgTextHorizontalAlign.RIGHT) {
      anchor = "end";
    }
    return this.lines(lines, fontsize, insertionPoint, extentsWidth, anchor);
  }
  vertices(vertices, closed = false) {
    const bbox = vertices.reduce(
      (acc, point) => acc.expandByPoint(point),
      new Box2D()
    );
    let d = vertices.reduce((acc, point, i) => {
      acc += i === 0 ? "M" : "L";
      acc += point.x + "," + point.y;
      return acc;
    }, "");
    if (closed) {
      d += "Z";
    }
    return { bbox, element: `<path d="${d}" />` };
  }
  circle(entity) {
    const bbox0 = new Box2D().expandByPoint({
      x: entity.center.x + entity.radius,
      y: entity.center.y + entity.radius
    }).expandByPoint({
      x: entity.center.x - entity.radius,
      y: entity.center.y - entity.radius
    });
    const element0 = `<circle cx="${entity.center.x}" cy="${entity.center.y}" r="${entity.radius}" />`;
    return {
      bbox: bbox0,
      element: element0
    };
  }
  ellipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
    const rx = Math.sqrt(majorX * majorX + majorY * majorY);
    const ry = axisRatio * rx;
    const rotationAngle = -Math.atan2(-majorY, majorX);
    const bbox = this.bboxEllipseOrArc(
      cx,
      cy,
      majorX,
      majorY,
      axisRatio,
      startAngle,
      endAngle
    );
    if (Math.abs(startAngle - endAngle) < 1e-9 || Math.abs(startAngle - endAngle + Math.PI * 2) < 1e-9) {
      const element = `<g transform="rotate(${rotationAngle / Math.PI * 180} ${cx}, ${cy})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" /></g>`;
      return { bbox, element };
    } else {
      const startOffset = this.rotate(
        { x: Math.cos(startAngle) * rx, y: Math.sin(startAngle) * ry },
        rotationAngle
      );
      const startPoint = { x: cx + startOffset.x, y: cy + startOffset.y };
      const endOffset = this.rotate(
        { x: Math.cos(endAngle) * rx, y: Math.sin(endAngle) * ry },
        rotationAngle
      );
      const endPoint = { x: cx + endOffset.x, y: cy + endOffset.y };
      const adjustedEndAngle = endAngle < startAngle ? endAngle + Math.PI * 2 : endAngle;
      const largeArcFlag = adjustedEndAngle - startAngle < Math.PI ? 0 : 1;
      const d = `M ${startPoint.x} ${startPoint.y} A ${rx} ${ry} ${rotationAngle / Math.PI * 180} ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y}`;
      const element = `<path d="${d}" />`;
      return { bbox, element };
    }
  }
  bboxEllipseOrArc(cx, cy, majorX, majorY, axisRatio, startAngle, endAngle) {
    while (startAngle < 0) startAngle += Math.PI * 2;
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
    const angles = [];
    if (Math.abs(majorX) < 1e-12 || Math.abs(majorY) < 1e-12) {
      for (let i = 0; i < 4; i++) {
        angles.push(i / 2 * Math.PI);
      }
    } else {
      angles[0] = Math.atan(-majorY * axisRatio / majorX) - Math.PI;
      angles[1] = Math.atan(majorX * axisRatio / majorY) - Math.PI;
      angles[2] = angles[0] - Math.PI;
      angles[3] = angles[1] - Math.PI;
    }
    for (let i = 4; i >= 0; i--) {
      while (angles[i] < startAngle) angles[i] += Math.PI * 2;
      if (angles[i] > endAngle) {
        angles.splice(i, 1);
      }
    }
    angles.push(startAngle);
    angles.push(endAngle);
    const pts = angles.map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
    const M = [
      [majorX, -majorY * axisRatio],
      [majorY, majorX * axisRatio]
    ];
    const rotatedPts = pts.map((p) => ({
      x: p.x * M[0][0] + p.y * M[0][1] + cx,
      y: p.x * M[1][0] + p.y * M[1][1] + cy
    }));
    const bbox = rotatedPts.reduce(
      (acc, p) => {
        acc.expandByPoint(p);
        return acc;
      },
      new Box2D()
    );
    return bbox;
  }
  ellipse(entity) {
    const { bbox: bbox0, element: element0 } = this.ellipseOrArc(
      entity.center.x,
      entity.center.y,
      entity.majorAxisEndPoint.x,
      entity.majorAxisEndPoint.y,
      entity.axisRatio,
      entity.startAngle,
      entity.endAngle
    );
    return {
      bbox: bbox0,
      element: element0
    };
  }
  arc(entity) {
    const { bbox: bbox0, element: element0 } = this.ellipseOrArc(
      entity.center.x,
      entity.center.y,
      entity.radius,
      0,
      1,
      entity.startAngle,
      entity.endAngle
    );
    return {
      bbox: bbox0,
      element: element0
    };
  }
  dimension(entity) {
    const block = this.blockMap.get(entity.name);
    if (block) {
      return {
        bbox: block.bbox,
        element: `<use href="#${entity.name}" />`
      };
    }
    return null;
  }
  insert(entity) {
    const block = this.blockMap.get(entity.name);
    if (block) {
      const insertionPoint = entity.insertionPoint;
      const rotation = entity.rotation * (180 / Math.PI);
      const transform = `translate(${insertionPoint.x},${insertionPoint.y}) rotate(${rotation}) scale(${entity.xScale},${entity.yScale})`;
      const newBBox = block.bbox.clone().transform(
        { x: entity.xScale, y: entity.yScale },
        { x: insertionPoint.x, y: insertionPoint.y }
      ).rotate(entity.rotation, insertionPoint);
      return {
        bbox: newBBox,
        element: `<use href="#${entity.name}" transform="${transform}" />`
      };
    }
    return null;
  }
  block(block, dwg) {
    const entities = block.entities;
    const { bbox, elements } = entities.reduce(
      (acc, entity) => {
        const boundsAndElement = this.entityToBoundsAndElement(entity);
        if (boundsAndElement) {
          const { bbox: bbox2, element } = boundsAndElement;
          if (bbox2.valid) {
            acc.bbox.expandByPoint(bbox2.min);
            acc.bbox.expandByPoint(bbox2.max);
          }
          const color = this.getEntityColor(dwg.tables.LAYER.entries, entity);
          const fill = entity.type == "TEXT" || entity.type == "MTEXT" ? color.cssColor : "none";
          if (color.isByBlock) {
            acc.elements.push(`<g id="${entity.handle}">${element}</g>`);
          } else {
            acc.elements.push(
              `<g id="${entity.handle}" stroke="${color.cssColor}" fill="${fill}">${element}</g>`
            );
          }
        }
        return acc;
      },
      {
        bbox: new Box2D(),
        elements: []
      }
    );
    if (bbox.valid) {
      return {
        bbox,
        element: `<g id="${block.name}">${elements.join("\n")}</g>`
      };
    }
    return null;
  }
  entityToBoundsAndElement(entity) {
    let result = null;
    switch (entity.type) {
      case "ARC":
        result = this.arc(entity);
        break;
      case "CIRCLE":
        result = this.circle(entity);
        break;
      case "DIMENSION":
        result = this.dimension(entity);
        break;
      case "ELLIPSE":
        result = this.ellipse(entity);
        break;
      case "INSERT":
        result = this.insert(entity);
        break;
      case "LINE":
        result = this.line(entity);
        break;
      case "LWPOLYLINE": {
        const lwpolyline = entity;
        const closed = !!(lwpolyline.flag & 512);
        const vertices = interpolatePolyline(lwpolyline, closed);
        result = this.vertices(vertices, closed);
        break;
      }
      case "MTEXT":
        result = this.mtext(entity);
        break;
      case "SPLINE": {
        const spline = entity;
        result = this.vertices(
          this.interpolateBSpline(
            spline.controlPoints,
            spline.degree,
            spline.knots,
            25,
            spline.weights
          )
        );
        break;
      }
      case "POLYLINE": {
        break;
      }
      case "RAY":
        result = this.ray(entity);
        break;
      case "TABLE":
        result = this.table(entity);
        break;
      case "TEXT":
        result = this.text(entity);
        break;
      case "XLINE":
        result = this.xline(entity);
        break;
      default:
        result = null;
        break;
    }
    if (result) {
      return this.addFlipXIfApplicable(entity, result);
    }
    return null;
  }
  getEntityColor(layers, entity) {
    const color = new Color();
    if (entity.colorIndex != null) {
      color.colorIndex = entity.colorIndex;
    } else if (entity.colorName) {
      color.colorName = entity.colorName;
    } else if (entity.color != null) {
      color.color = entity.color;
    }
    if (color.colorIndex == 7) {
      color.colorIndex = 256;
    }
    if (color.isByLayer) {
      const layer = layers.find(
        (layer2) => layer2.name === entity.layer
      );
      if (layer != null) {
        color.colorIndex = layer.colorIndex;
      }
    }
    if (color.color == null) {
      color.color = 16777215;
    }
    return color;
  }
  convert(dwg) {
    let modelSpace = null;
    this.blockMap.clear();
    let blockElements = "";
    dwg.tables.BLOCK_RECORD.entries.forEach((block) => {
      if (isModelSpace(block.name)) {
        modelSpace = block;
      } else {
        const item = this.block(block, dwg);
        if (item) {
          blockElements += item.element;
          this.blockMap.set(block.name, item);
        }
      }
    });
    const ms = this.block(modelSpace, dwg);
    const viewBox = ms && ms.bbox.valid ? {
      x: ms.bbox.min.x,
      y: -ms.bbox.max.y,
      width: ms.bbox.max.x - ms.bbox.min.x,
      height: ms.bbox.max.y - ms.bbox.min.y
    } : {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
    return `<?xml version="1.0"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
  preserveAspectRatio="xMinYMin meet"
  viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"
  width="100%" height="100%"
>
  <defs>${blockElements}</defs>
  <g stroke="#000000" stroke-width="0.1%" fill="none" transform="matrix(1,0,0,-1,0,0)">
    ${ms ? ms.element : ""}
  </g>
</svg>`;
  }
}
var DwgThumbnailImageType = /* @__PURE__ */ ((DwgThumbnailImageType2) => {
  DwgThumbnailImageType2[DwgThumbnailImageType2["BMP"] = 2] = "BMP";
  DwgThumbnailImageType2[DwgThumbnailImageType2["WMF"] = 3] = "WMF";
  DwgThumbnailImageType2[DwgThumbnailImageType2["PNG"] = 6] = "PNG";
  return DwgThumbnailImageType2;
})(DwgThumbnailImageType || {});
const _LibreDwg = class _LibreDwg {
  constructor(wasmInstance) {
    __publicField(this, "wasmInstance");
    __publicField(this, "decoder");
    this.wasmInstance = wasmInstance;
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        return Reflect.get(target.wasmInstance, prop, receiver);
      }
    });
  }
  dwg_read_data(fileContent, fileType) {
    if (fileType == Dwg_File_Type.DWG) {
      const fileName = "tmp.dwg";
      try {
        this.wasmInstance.FS.writeFile(
          fileName,
          new Uint8Array(fileContent)
        );
        const result = this.wasmInstance.dwg_read_file(fileName);
        if (result.error & Dwg_Error.OUTOFMEM) {
          this.wasmInstance.dwg_abandon(result.data);
          throw new Error(
            "Failed to decode DWG: out of WASM memory. Rebuild with pnpm build:wasm (INITIAL_MEMORY=1GB) or use a smaller file."
          );
        }
        if (result.error != 0) {
          console.warn("Open dwg file with error code:", result.error);
        }
        return result.data;
      } finally {
        if (this.wasmInstance.FS.analyzePath(fileName, false).exists) {
          this.wasmInstance.FS.unlink(fileName);
        }
      }
    }
  }
  /**
   * Converts DWG file content to DXF file content.
   * @param fileContent DWG file content.
   * @returns Returns DXF file content if conversion succeeds. Otherwise returns null.
   */
  dwg_write_dxf(fileContent) {
    const inputFileName = "tmp.dwg";
    const outputFileName = "tmp.dxf";
    try {
      this.wasmInstance.FS.writeFile(
        inputFileName,
        new Uint8Array(fileContent)
      );
      const error = this.wasmInstance.dwg_write_dxf(
        inputFileName,
        outputFileName
      );
      if (error != 0) {
        console.log("Convert dwg to dxf with error code: ", error);
        return null;
      }
      return this.wasmInstance.FS.readFile(outputFileName);
    } finally {
      if (this.wasmInstance.FS.analyzePath(inputFileName, false).exists) {
        this.wasmInstance.FS.unlink(inputFileName);
      }
      if (this.wasmInstance.FS.analyzePath(outputFileName, false).exists) {
        this.wasmInstance.FS.unlink(outputFileName);
      }
    }
  }
  /**
   * Gets the version of the dwg.
   * @param data Pointer to Dwg_Data instance.
   * @returns Return the version of the dwg
   */
  dwg_get_version_type(data) {
    const version = this.wasmInstance.dwg_get_version_type(data);
    return dwgVersions[version];
  }
  /**
   * Gets code page of the dwg.
   * @param data Pointer to Dwg_Data instance.
   * @returns Return code page of the dwg
   */
  dwg_get_codepage(data) {
    const codepage = this.wasmInstance.dwg_get_codepage(data);
    return codepage;
  }
  /**
   * Extracts thumbnail image from dwg.
   * @param data Pointer to Dwg_Data instance.
   * @returns Return thumbnail image data
   */
  dwg_bmp(data) {
    return this.wasmInstance.dwg_bmp(data);
  }
  /**
   * Returns the number of classes in dwg file.
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns the number of classes in dwg file.
   */
  dwg_get_num_classes(data) {
    return this.wasmInstance.dwg_get_num_classes(data);
  }
  /**
   * Returns the nth class in dwg file.
   * @param data Pointer to Dwg_Data instance.
   * @param index Index of the class
   * @returns Returns the nth class in dwg file.
   */
  dwg_get_class(data, index) {
    return this.wasmInstance.dwg_get_class(data, index);
  }
  /**
   * Converts Dwg_Data instance to DwgDatabase instance. DwgDatabase instance doesn't depend on
   * Dwg_Data instance any more after conversion. So you can call function dwg_free to free memory
   * occupied by Dwg_Data.
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns the converted DwgDatabase.
   */
  convert(data) {
    const codepage = this.dwg_get_codepage(data);
    const encoding = dwgCodePageToEncoding(codepage);
    this.decoder = new TextDecoder(encoding);
    const converter = new LibreDwgConverter(this);
    return converter.convert(data);
  }
  /**
   * Converts Dwg_Data instance to DwgDatabase instance and returns conversion statistics.
   * DwgDatabase instance doesn't depend on Dwg_Data instance any more after conversion.
   * So you can call function dwg_free to free memory occupied by Dwg_Data.
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns the converted DwgDatabase and conversion statistics.
   */
  convertEx(data) {
    const codepage = this.dwg_get_codepage(data);
    const encoding = dwgCodePageToEncoding(codepage);
    this.decoder = new TextDecoder(encoding);
    const converter = new LibreDwgConverter(this);
    return {
      database: converter.convert(data),
      stats: converter.getConversionStats()
    };
  }
  /**
   * Converts DwgDatabase instance to svg string.
   * @param data DwgDatabase instance.
   * @returns Returns the converted svg string.
   */
  dwg_to_svg(data) {
    const converter = new SvgConverter();
    return converter.convert(data);
  }
  /**
   * Frees the whole DWG. all tables, sections, objects, ...
   * @param data Pointer to Dwg_Data instance.
   */
  dwg_free(data) {
    if (!data) {
      return;
    }
    try {
      this.wasmInstance.dwg_free(data);
    } catch {
      try {
        this.wasmInstance.dwg_abandon(data);
      } catch {
      }
    }
  }
  /**
   * Frees the object (all three structs and its fields)
   * @group Dwg_Object Methods
   * @param ptr Pointer to one Dwg_Object instance.
   */
  dwg_free_object(obj_ptr) {
    this.wasmInstance.dwg_free_object(obj_ptr);
  }
  /**
   * Gets an object by its handle.
   * @group Handle Conversion Methods
   * @param data Pointer to Dwg_Data instance.
   * @param ref_ptr Pointer to Dwg_Object_Ref instance.
   * @returns Returns the object whose handle is equal to the given handle.
   */
  dwg_ref_object(data, ref_ptr) {
    return this.wasmInstance.dwg_ref_object(data, ref_ptr);
  }
  /**
   * Gets an object by its handle without warning message.
   * @group Handle Conversion Methods
   * @param data Pointer to Dwg_Data instance.
   * @param ref_ptr Pointer to Dwg_Object_Ref instance.
   * @returns Returns the object whose handle is equal to the given handle.
   */
  dwg_ref_object_silent(data, ref_ptr) {
    return this.wasmInstance.dwg_ref_object_silent(data, ref_ptr);
  }
  /**
   * Gets an object given its handle and relative base object.
   * @group Handle Conversion Methods
   * @param data Pointer to Dwg_Data instance.
   * @param ref_ptr Pointer to Dwg_Object_Ref instance.
   * @param obj_ptr Pointer to the relative base object (Dwg_Object instance).
   * @returns Returns the object given its handle and relative base object.
   */
  dwg_ref_object_relative(data, ref_ptr, obj_ptr) {
    return this.wasmInstance.dwg_ref_object_relative(data, ref_ptr, obj_ptr);
  }
  /**
   * Resolves handle absref value to Dwg_Object instance.
   * @group Handle Conversion Methods
   * @param data Pointer to Dwg_Data instance.
   * @param absref Handle absref value.
   * @returns Returns the object with the given handle absref value.
   */
  dwg_resolve_handle(data, absref) {
    return this.wasmInstance.dwg_resolve_handle(data, absref);
  }
  /**
   * Resolves handle absref value to Dwg_Object instance without warning message.
   * @group Handle Conversion Methods
   * @param data Pointer to Dwg_Data instance.
   * @param absref Handle absref value.
   * @returns Returns the object with the given handle absref value.
   */
  dwg_resolve_handle_silent(data, absref) {
    return this.wasmInstance.dwg_resolve_handle_silent(data, absref);
  }
  /**
   * Sets ref->absolute_ref from the specified obj for a subsequent dwg_resolve_handle
   * @group Handle Conversion Methods
   * @param ref_ptr Pointer to Dwg_Object_Ref instance.
   * @param obj_ptr Pointer to Dwg_Object instance.
   * @returns Returns 1 if set absref value correctly. Otherwise, return 0.
   */
  dwg_resolve_handleref(ref_ptr, obj_ptr) {
    return this.wasmInstance.dwg_resolve_handleref(ref_ptr, obj_ptr);
  }
  /**
   * Returns object (such as line type, layer name, dimension style, and etc.) name by its handle.
   * @group Handle Conversion Methods
   * @param ref_ptr Pointer to Dwg_Object_Ref instance.
   * @returns Returns object name by its handle.
   */
  dwg_ref_get_object_name(ref_ptr) {
    const wasmInstance = this.wasmInstance;
    const obj = wasmInstance.dwg_ref_get_object(ref_ptr);
    const obj_tio = wasmInstance.dwg_object_to_object_tio(obj);
    const obj_name = this.dwg_dynapi_entity_value(obj_tio, "name").data;
    return obj_name;
  }
  /**
   * Converts Dwg_Object_Object instance to Dwg_Object instance.
   * @group Object Conversion Methods
   * @param obj_ptr Pointer to Dwg_Object_Object instance.
   * @returns Returns one pointer to Dwg_Object instance.
   */
  dwg_obj_obj_to_object(obj_obj_ptr) {
    return this.wasmInstance.dwg_obj_obj_to_object(obj_obj_ptr);
  }
  /**
   * Converts Dwg_Object_* instance to Dwg_Object instance.
   * @group Object Conversion Methods
   * @param obj_generic_ptr Pointer to Dwg_Object_* instance.
   * @returns Returns one pointer to Dwg_Object instance.
   */
  dwg_obj_generic_to_object(obj_generic_ptr) {
    return this.wasmInstance.dwg_obj_generic_to_object(obj_generic_ptr);
  }
  /**
   * Converts Dwg_Object instance to Dwg_Object_Object instance.
   * @group Object Conversion Methods
   * @param obj_ptr Pointer to Dwg_Object instance.
   * @returns Returns one pointer to Dwg_Object_Object instance.
   */
  dwg_object_to_object(obj_ptr) {
    return this.wasmInstance.dwg_object_to_object(obj_ptr);
  }
  /**
   * Gets Dwg_Object_* instance (such as Dwg_Entity_LAYER, Dwg_Entity_STYLE, and etc.)
   * from Dwg_Object instance.
   * @group Object Conversion Methods
   * @param obj_ptr Pointer to Dwg_Object instance.
   * @returns Returns one pointer to Dwg_Object_Object_TIO_Ptr instance.
   */
  dwg_object_to_object_tio(obj_ptr) {
    return this.wasmInstance.dwg_object_to_object_tio(obj_ptr);
  }
  /**
   * Converts Dwg_Object instance to Dwg_Object_Entity instance.
   * @group Object Conversion Methods
   * @param obj_ptr Pointer to Dwg_Object instance.
   * @returns Returns one pointer to Dwg_Object_Entity instance.
   */
  dwg_object_to_entity(obj_ptr) {
    return this.wasmInstance.dwg_object_to_entity(obj_ptr);
  }
  /**
   * Gets Dwg_Entity_* instance (such as Dwg_Entity_LINE, Dwg_Entity_SPLINE, and etc.)
   * from Dwg_Object instance.
   * @group Object Conversion Methods
   * @param obj_ptr Pointer to Dwg_Object instance.
   * @returns Returns one pointer to Dwg_Object_Object_TIO_Ptr instance.
   */
  dwg_object_to_entity_tio(obj_ptr) {
    return this.wasmInstance.dwg_object_to_entity_tio(obj_ptr);
  }
  /**
   * Returns all of entities in the model space. Each item in returned array
   * is one Dwg_Object pointer (Dwg_Object*).
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of entities in the model space.
   */
  dwg_getall_entities_in_model_space(data) {
    const wasmInstance = this.wasmInstance;
    const model_space = wasmInstance.dwg_model_space_object(data);
    const entities = [];
    let next = wasmInstance.get_first_owned_entity(model_space);
    while (next) {
      entities.push(next);
      next = wasmInstance.get_next_owned_entity(model_space, next);
    }
    return entities;
  }
  /**
   * Returns all of objects in Dwg_Data instance with the specified type.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @param type Object type.
   * @returns Returns all of objects with the specified type.
   */
  dwg_getall_object_by_type(data, type) {
    const wasmInstance = this.wasmInstance;
    const num_objects = wasmInstance.dwg_get_num_objects(data);
    const results = [];
    for (let i = 0; i < num_objects; i++) {
      const obj = wasmInstance.dwg_get_object(data, i);
      const tio = wasmInstance.dwg_object_to_object_tio(obj);
      if (tio && wasmInstance.dwg_object_get_fixedtype(obj) == type) {
        results.push(tio);
      }
    }
    return results;
  }
  /**
   * Returns all of objects in Dwg_Data instance with the specified type.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @param type Object type.
   * @returns Returns all of objects with the specified type.
   */
  dwg_getall_entity_by_type(data, type) {
    const wasmInstance = this.wasmInstance;
    const num_objects = wasmInstance.dwg_get_num_objects(data);
    const results = [];
    for (let i = 0; i < num_objects; i++) {
      const obj = wasmInstance.dwg_get_object(data, i);
      const tio = wasmInstance.dwg_object_to_entity_tio(obj);
      if (tio && wasmInstance.dwg_object_get_fixedtype(obj) == type) {
        results.push(tio);
      }
    }
    return results;
  }
  /**
   * Returns all of layer objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of layer objects in Dwg_Data instance.
   */
  dwg_getall_LAYER(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_LAYER);
  }
  /**
   * Returns all of line type objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of line type objects in Dwg_Data instance.
   */
  dwg_getall_LTYPE(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_LTYPE);
  }
  /**
   * Returns all of text style objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of text style objects in Dwg_Data instance.
   */
  dwg_getall_STYLE(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_STYLE);
  }
  /**
   * Returns all of dimension style objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of dimension style objects in Dwg_Data instance.
   */
  dwg_getall_DIMSTYLE(data) {
    return this.dwg_getall_object_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_DIMSTYLE
    );
  }
  /**
   * Returns all of viewport objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of viewport objects in Dwg_Data instance.
   */
  dwg_getall_VPORT(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_VPORT);
  }
  /**
   * Returns all of layout objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of layout objects in Dwg_Data instance.
   */
  dwg_getall_LAYOUT(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_LAYOUT);
  }
  /**
   * Returns all of block objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of block objects in Dwg_Data instance.
   */
  dwg_getall_BLOCK(data) {
    return this.dwg_getall_object_by_type(data, Dwg_Object_Type.DWG_TYPE_BLOCK);
  }
  /**
   * Returns all of block header objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of block header objects in Dwg_Data instance.
   */
  dwg_getall_BLOCK_HEADER(data) {
    return this.dwg_getall_object_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_BLOCK_HEADER
    );
  }
  /**
   * Returns all of image definition objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of image definition objects in Dwg_Data instance.
   */
  dwg_getall_IMAGEDEF(data) {
    return this.dwg_getall_object_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_IMAGEDEF
    );
  }
  /**
   * Returns all of 2d vertex objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of 2d vertex objects in Dwg_Data instance.
   */
  dwg_getall_VERTEX_2D(data) {
    return this.dwg_getall_entity_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_VERTEX_2D
    );
  }
  /**
   * Returns all of 3d vertex objects in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of 3d vertex objects in Dwg_Data instance.
   */
  dwg_getall_VERTEX_3D(data) {
    return this.dwg_getall_entity_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_VERTEX_3D
    );
  }
  /**
   * Returns all of 2d polyline entities in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of 2d polyline entities in Dwg_Data instance.
   */
  dwg_getall_POLYLINE_2D(data) {
    return this.dwg_getall_entity_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_POLYLINE_2D
    );
  }
  /**
   * Returns all of 3d polyline entities in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of 3d polyline entities in Dwg_Data instance.
   */
  dwg_getall_POLYLINE_3D(data) {
    return this.dwg_getall_entity_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_POLYLINE_3D
    );
  }
  /**
   * Returns all of image entities in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of image entities in Dwg_Data instance.
   */
  dwg_getall_IMAGE(data) {
    return this.dwg_getall_entity_by_type(data, Dwg_Object_Type.DWG_TYPE_IMAGE);
  }
  /**
   * Returns all of lwpolyline entities in Dwg_Data instance.
   * @group GetAll Methods
   * @param data Pointer to Dwg_Data instance.
   * @returns Returns all of lwpolyline entities in Dwg_Data instance.
   */
  dwg_getall_LWPOLYLINE(data) {
    return this.dwg_getall_entity_by_type(
      data,
      Dwg_Object_Type.DWG_TYPE_LWPOLYLINE
    );
  }
  /**
   * Converts one C++ handle array to one JavaScript Dwg_Object_Ref array.
   * @group Array Methods
   * @param ptr Pointer to C++ handle array.
   * @param size The size of C++ handle array.
   * @returns Returns one JavaScript Dwg_Object_Ref array from the specified C++ handle array.
   */
  dwg_ptr_to_object_ref_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_object_ref_array(ptr, size);
  }
  /**
   * Converts one C++ handle array to one JavaScript Dwg_Object_Ref_Ptr array.
   * @group Array Methods
   * @param ptr Pointer to C++ handle array.
   * @param size The size of C++ handle array.
   * @returns Returns one JavaScript Dwg_Object_Ref_Ptr array from the specified C++ handle array.
   */
  dwg_ptr_to_object_ref_ptr_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_object_ref_ptr_array(ptr, size);
  }
  /**
   * Converts one C++ wchar_t* array to one JavaScript string array.
   * @group Array Methods
   * @param ptr Pointer to C++ wchar_t* array.
   * @param size The size of C++ wchar_t* array.
   * @returns Returns one JavaScript string array from the specified C++ wchar_t* array.
   */
  dwg_ptr_to_wchar_string_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_wchar_string_array(ptr, size);
  }
  /**
   * Converts one C++ unsigned char array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ unsigned char array.
   * @param size The size of C++ unsigned char array.
   * @returns Returns one JavaScript number array from the specified C++ unsigned char array.
   */
  dwg_ptr_to_unsigned_char_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_unsigned_char_array(ptr, size);
  }
  /**
   * Converts one C++ signed char array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ signed char array.
   * @param size The size of C++ signed char array.
   * @returns Returns one JavaScript number array from the specified C++ signed char array.
   */
  dwg_ptr_to_signed_char_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_signed_char_array(ptr, size);
  }
  /**
   * Converts one C++ unsigned int16 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ unsigned int16 array.
   * @param size The size of C++ unsigned int16 array.
   * @returns Returns one JavaScript number array from the specified C++ unsigned int16 array.
   */
  dwg_ptr_to_uint16_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_uint16_t_array(ptr, size);
  }
  /**
   * Converts one C++ int16 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ int16 array.
   * @param size The size of C++ int16 array.
   * @returns Returns one JavaScript number array from the specified C++ int16 array.
   */
  dwg_ptr_to_int16_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_int16_t_array(ptr, size);
  }
  /**
   * Converts one C++ unsigned int32 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ unsigned int32 array.
   * @param size The size of C++ unsigned int32 array.
   * @returns Returns one JavaScript number array from the specified C++ unsigned int32 array.
   */
  dwg_ptr_to_uint32_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_uint32_t_array(ptr, size);
  }
  /**
   * Converts one C++ int32 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ int32 array.
   * @param size The size of C++ int32 array.
   * @returns Returns one JavaScript number array from the specified C++ int32 array.
   */
  dwg_ptr_to_int32_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_int32_t_array(ptr, size);
  }
  /**
   * Converts one C++ unsigned int64 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ unsigned int64 array.
   * @param size The size of C++ unsigned int64 array.
   * @returns Returns one JavaScript number array from the specified C++ unsigned int64 array.
   */
  dwg_ptr_to_uint64_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_uint64_t_array(ptr, size);
  }
  /**
   * Converts one C++ int64 array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ int64 array.
   * @param size The size of C++ int64 array.
   * @returns Returns one JavaScript number array from the specified C++ int64 array.
   */
  dwg_ptr_to_int64_t_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_int64_t_array(ptr, size);
  }
  /**
   * Converts one C++ double array to one JavaScript number array.
   * @group Array Methods
   * @param ptr Pointer to C++ double array.
   * @param size The size of C++ double array.
   * @returns Returns one JavaScript number array from the specified C++ double array.
   */
  dwg_ptr_to_double_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_double_array(ptr, size);
  }
  /**
   * Converts one C++ 2d point array to one JavaScript 2d point array.
   * @group Array Methods
   * @param ptr Pointer to C++ 2d point array.
   * @param size The size of C++ 2 point array.
   * @returns Returns one JavaScript 2d point array from the specified C++ 2d point array.
   */
  dwg_ptr_to_point2d_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_point2d_array(ptr, size);
  }
  /**
   * Converts one C++ 3d point array to one JavaScript 3d point array.
   * @group Array Methods
   * @param ptr Pointer to C++ 3d point array.
   * @param size The size of C++ 3d point array.
   * @returns Returns one JavaScript 3d point array from the specified C++ 3d point array.
   */
  dwg_ptr_to_point3d_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_point3d_array(ptr, size);
  }
  /**
   * Converts one C++ 4d point array to one JavaScript 4d point array.
   * @group Array Methods
   * @param ptr Pointer to C++ 4d point array.
   * @param size The size of C++ 4d point array.
   * @returns Returns one JavaScript 4d point array from the specified C++ 4d point array.
   */
  dwg_ptr_to_point4d_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_point4d_array(ptr, size);
  }
  /**
   * Converts one C++ line type array to one JavaScript line type array.
   * @group Array Methods
   * @param ptr Pointer to C++ line type array.
   * @param size The size of C++ line type array.
   * @returns Returns one JavaScript line type array from the specified C++ line type array.
   */
  dwg_ptr_to_ltype_dash_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_ltype_dash_array(ptr, size);
  }
  /**
   * Converts one C++ table cell array to one JavaScript table cell array.
   * @group Array Methods
   * @group Dwg_Entity_TABLE Methods
   * @param ptr Pointer to C++ table cell array.
   * @param size The size of C++ table cell array.
   * @returns Returns one JavaScript table cell array from the specified C++ table cell array.
   */
  dwg_ptr_to_table_cell_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_table_cell_array(ptr, size);
  }
  /**
   * Converts one C++ hatch definition line array to one JavaScript hatch definition line array.
   * @group Array Methods
   * @group Dwg_Entity_HATCH Methods
   * @param ptr Pointer to C++ hatch definition line array.
   * @param size The size of C++ hatch definition line array.
   * @returns Returns one JavaScript hatch definition line array from the specified C++ hatch definition line array.
   */
  dwg_ptr_to_hatch_defline_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_hatch_defline_array(ptr, size);
  }
  /**
   * Converts one C++ hatch path array to one JavaScript hatch path array.
   * @group Array Methods
   * @group Dwg_Entity_HATCH Methods
   * @param ptr Pointer to C++ hatch path array.
   * @param size The size of C++ hatch path array.
   * @returns Returns one JavaScript hatch path array from the specified C++ hatch path array.
   */
  dwg_ptr_to_hatch_path_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_hatch_path_array(ptr, size);
  }
  /**
   * Converts one C++ hatch gradient color array to one JavaScript hatch gradient color array.
   * @group Array Methods
   * @group Dwg_Entity_HATCH Methods
   * @param ptr Pointer to C++ hatch gradient color array.
   * @param size The size of C++ hatch gradient color array.
   * @returns Returns one JavaScript hatch gradient color array from the specified C++ hatch gradient color array.
   */
  dwg_ptr_to_hatch_gradient_color_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_hatch_gradient_color_array(ptr, size);
  }
  /**
   * Converts one C++ mline vertex array to one JavaScript mline vertex array.
   * @group Array Methods
   * @group Dwg_Entity_MLINE Methods
   * @param ptr Pointer to C++ mline vertex array.
   * @param size The size of C++ mline vertex array.
   * @returns Returns one JavaScript mline vertex array from the specified C++ mline vertex array.
   */
  dwg_ptr_to_mline_vertex_array(ptr, size) {
    return this.wasmInstance.dwg_ptr_to_mline_vertex_array(ptr, size);
  }
  /**
   * Generic field value getter. Used to get the field value of one object or entity.
   * @group Dynamic API Methods
   * @param obj Pointer to one object or entity
   * @param field Field name of one object or entity
   * @returns Returns the field value of one object or entity.
   */
  dwg_dynapi_entity_value(obj, field) {
    const value = this.wasmInstance.dwg_dynapi_entity_value(
      obj,
      field
    );
    if (value.bin && this.decoder) {
      value.data = this.decoder.decode(value.bin);
    }
    return value;
  }
  /**
   * Header field value getter. Used to get the field value of dwg/dxf header.
   * @group Dynamic API Methods
   * @param data Pointer to Dwg_Data instance.
   * @param field Field name of header.
   * @returns Returns the field value of dwg/dxf header.
   */
  dwg_dynapi_header_value(data, field) {
    return this.wasmInstance.dwg_dynapi_header_value(data, field);
  }
  /**
   * The common field value getter. Used to get the value of object or entity common fields.
   * @group Dynamic API Methods
   * @param obj Pointer to one object or entity
   * @param field The name of object or entity common fields.
   * @returns Returns the value of object or entity common fields.
   */
  dwg_dynapi_common_value(obj, field) {
    return this.wasmInstance.dwg_dynapi_common_value(obj, field);
  }
  /**
   * The field of one object or entity may not be primitive type. It means one field may consist of
   * multiple sub-fields. This method is used to get the sub-field value of those complex field.
   * @group Dynamic API Methods
   * @param obj Pointer to one object or entity.
   * @param subclass The class name of the field with complex type.
   * @param field The field name of one object or entit.
   * @returns Returns the sub-field value of one complex field.
   */
  dwg_dynapi_subclass_value(obj, subclass, field) {
    return this.wasmInstance.dwg_dynapi_subclass_value(obj, subclass, field);
  }
  /**
   * Returns the handle of one Dwg_Object instance.
   * @group Dwg_Object Methods
   * @param ptr Pointer to one Dwg_Object instance.
   * @returns Returns the handle of one Dwg_Object instance.
   */
  dwg_object_get_handle_object(ptr) {
    return this.wasmInstance.dwg_object_get_handle_object(ptr);
  }
  /**
   * Returns the handle of one Dwg_Object_Object instance.
   * @group Dwg_Object_Object Methods
   * @param ptr Pointer to one Dwg_Object_Object instance.
   * @returns Returns the handle of one Dwg_Object_Object instance.
   */
  dwg_object_object_get_handle_object(ptr) {
    return this.wasmInstance.dwg_object_object_get_handle_object(ptr);
  }
  /**
   * Returns the owner handle of one Dwg_Object_Object instance.
   * @group Dwg_Object_Object Methods
   * @param ptr Pointer to one Dwg_Object_Object instance.
   * @returns Returns the owner handle of one Dwg_Object_Object instance.
   */
  dwg_object_object_get_ownerhandle_object(ptr) {
    return this.wasmInstance.dwg_object_object_get_ownerhandle_object(ptr);
  }
  /**
   * Returns the handle of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns the handle of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_handle_object(ptr) {
    return this.wasmInstance.dwg_object_entity_get_handle_object(ptr);
  }
  /**
   * Returns the owner handle of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns the owner handle of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_ownerhandle_object(ptr) {
    return this.wasmInstance.dwg_object_entity_get_ownerhandle_object(ptr);
  }
  /**
   * Returns hard-owner ID/handle to owner dictionary of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns hard-owner ID/handle to owner dictionary of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_xdicobjhandle_object(ptr) {
    return this.wasmInstance.dwg_object_entity_get_xdicobjhandle_object(ptr);
  }
  /**
   * Returns the layer handle of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns the layer handle of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_layer_object_ref(ptr) {
    return this.wasmInstance.dwg_object_entity_get_layer_object_ref(ptr);
  }
  /**
   * Returns the line type handle of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns the line type handle of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_ltype_object_ref(ptr) {
    return this.wasmInstance.dwg_object_entity_get_ltype_object_ref(ptr);
  }
  /**
   * Returns color value of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns color value of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_color_object(ptr) {
    return this.wasmInstance.dwg_object_entity_get_color_object(ptr);
  }
  /**
   * Returns xdata of one Dwg_Object_Entity instance.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns xdata of one Dwg_Object_Entity instance.
   */
  dwg_object_entity_get_xdata(ptr) {
    return this.wasmInstance.dwg_object_entity_get_xdata(ptr);
  }
  /**
   * Returns pointer to BLOCK_HEADER owner for generic entity from ent->ownerhandle.
   * @group Dwg_Object_Entity Methods
   * @param ptr Pointer to one Dwg_Object_Entity instance.
   * @returns Returns pointer to BLOCK_HEADER owner.
   */
  dwg_entity_owner(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_owner(ptr);
  }
  /**
   * Returns block name of one Dwg_Entity_* instance with one block field. For example,
   * dimension entities have one 'block' field which represents the block that contains
   * the entities that make up the dimension picture.
   * @group Dwg_Entity_* Methods
   * @param ptr Pointer to one Dwg_Entity_* instance  with one block field.
   * @param field Field name of the block.
   * @returns Returns block name of one Dwg_Entity_* instance.
   */
  dwg_entity_get_block_name(ptr, field) {
    const wasmInstance = this.wasmInstance;
    const block_header_ref = wasmInstance.dwg_dynapi_entity_value(ptr, field).data;
    const block_header_obj = wasmInstance.dwg_ref_get_object(block_header_ref);
    const block_header_tio = wasmInstance.dwg_object_to_object_tio(block_header_obj);
    const block = this.dwg_entity_block_header_get_block(block_header_tio);
    return block.name;
  }
  /**
   * Returns dimension style name of one Dwg_Entity_* instance with one dimension style
   * field.
   * @group Dwg_Entity_* Methods
   * @param ptr Pointer to one Dwg_Entity_* instance.
   * @param field Field name of the dimension style.
   * @returns Returns dimension style name of one Dwg_Entity_* instance.
   */
  dwg_entity_get_dimstyle_name(ptr, field = "dimstyle") {
    const wasmInstance = this.wasmInstance;
    const dimstyle_ref = wasmInstance.dwg_dynapi_entity_value(ptr, field).data;
    const dimstyle_obj = wasmInstance.dwg_ref_get_object(dimstyle_ref);
    const dimstyle_tio = wasmInstance.dwg_object_to_object_tio(dimstyle_obj);
    const dimstyle_name = this.dwg_dynapi_entity_value(dimstyle_tio, "name").data;
    return dimstyle_name;
  }
  /**
   * Returns block entity pointed by the specified block header.
   * @group Dwg_Entity_BLOCK_HEADER Methods
   * @param ptr Pointer to one Dwg_Entity_BLOCK_HEADER instance.
   * @returns Returns block entity pointed by the specified block header.
   */
  dwg_entity_block_header_get_block(ptr) {
    const wasmInstance = this.wasmInstance;
    const block_ref = wasmInstance.dwg_dynapi_entity_value(ptr, "block_entity").data;
    const block_obj = wasmInstance.dwg_ref_get_object(block_ref);
    const block_tio = wasmInstance.dwg_object_to_entity_tio(block_obj);
    const name = wasmInstance.dwg_dynapi_entity_value(block_tio, "name").data;
    const base_pt = wasmInstance.dwg_dynapi_entity_value(block_tio, "base_pt").data;
    return {
      name,
      base_pt
      // preR13 only
    };
  }
  /**
   * Returns preview image of the block pointed by the specified block header.
   * @group Dwg_Entity_BLOCK_HEADER Methods
   * @param ptr Pointer to one Dwg_Entity_BLOCK_HEADER instance.
   * @returns Returns preview image of the block pointed by the specified block header.
   */
  dwg_entity_block_header_get_preview(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_block_header_get_preview(ptr).data;
  }
  /**
   * Returns preview binary data of one entity (common entity preview field).
   * For PROXY_ENTITY this contains the proxy graphics data.
   */
  dwg_entity_get_preview(ptr) {
    const wasm = this.wasmInstance;
    if (typeof wasm.dwg_entity_get_preview !== "function") {
      return null;
    }
    const result = wasm.dwg_entity_get_preview(ptr);
    return (result == null ? void 0 : result.data) ?? null;
  }
  /**
   * Returns entity binary data of one Dwg_Entity_PROXY_ENTITY instance.
   * @group Dwg_Entity_PROXY_ENTITY Methods
   * @param ptr Pointer to one Dwg_Entity_PROXY_ENTITY instance.
   * @returns Entity data bytes, or null when absent.
   */
  dwg_entity_proxy_entity_get_entity_data(ptr) {
    const wasm = this.wasmInstance;
    if (typeof wasm.dwg_entity_proxy_entity_get_entity_data !== "function") {
      return null;
    }
    const result = wasm.dwg_entity_proxy_entity_get_entity_data(ptr);
    return (result == null ? void 0 : result.data) ?? null;
  }
  /**
   * Returns the first entity owned by the block header or null
   * @group Dwg_Entity_BLOCK_HEADER Methods
   * @param ptr Pointer to the block header.
   * @returns Returns the first entity owned by the block header or null
   */
  get_first_owned_entity(ptr) {
    return this.wasmInstance.get_first_owned_entity(ptr);
  }
  /**
   * Returns the next entity owned by the block header or null.
   * @group Dwg_Entity_BLOCK_HEADER Methods
   * @param ptr Pointer to the block header.
   * @param current Pointer to the current entity in the block header.
   * @returns Returns the next entity owned by the block header or null.
   */
  get_next_owned_entity(ptr, current) {
    return this.wasmInstance.get_next_owned_entity(ptr, current);
  }
  /**
   * Returns text style name of one Dwg_Entity_MTEXT instance.
   * @group Dwg_Entity_MTEXT Methods
   * @param ptr Pointer to one Dwg_Entity_MTEXT instance.
   * @returns Returns text style name of one Dwg_Entity_MTEXT instance.
   */
  dwg_entity_mtext_get_style_name(ptr) {
    const wasmInstance = this.wasmInstance;
    const style_ref = wasmInstance.dwg_dynapi_entity_value(ptr, "style").data;
    const style_obj = wasmInstance.dwg_ref_get_object(style_ref);
    const style_tio = wasmInstance.dwg_object_to_object_tio(style_obj);
    const name = wasmInstance.dwg_dynapi_entity_value(style_tio, "name").data;
    return name;
  }
  /**
   * Returns text style name of one Dwg_Entity_TEXT instance.
   * @group Dwg_Entity_TEXT Methods
   * @param ptr Pointer to one Dwg_Entity_TEXT instance.
   * @returns Returns text style name of one Dwg_Entity_TEXT instance.
   */
  dwg_entity_text_get_style_name(ptr) {
    return this.dwg_entity_mtext_get_style_name(ptr);
  }
  /**
   * Returns the number of points in Dwg_Entity_POLYLINE_2D.
   * @group Dwg_Entity_POLYLINE_2D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_2D) instance.
   * @returns Returns the number of points in one Dwg_Entity_POLYLINE_2D.
   */
  dwg_entity_polyline_2d_get_numpoints(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_2d_get_numpoints(ptr).data;
  }
  /**
   * Returns points in Dwg_Entity_POLYLINE_2D.
   * @group Dwg_Entity_POLYLINE_2D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_2D) instance.
   * @returns Returns points in one Dwg_Entity_POLYLINE_2D.
   */
  dwg_entity_polyline_2d_get_points(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_2d_get_points(ptr).data;
  }
  /**
   * Returns vertices in Dwg_Entity_POLYLINE_2D.
   * @group Dwg_Entity_POLYLINE_2D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_2D) instance.
   * @returns Returns vertices in one Dwg_Entity_POLYLINE_2D.
   */
  dwg_entity_polyline_2d_get_vertices(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_2d_get_vertices(ptr).data;
  }
  /**
   * Returns the number of points in Dwg_Entity_POLYLINE_3D.
   * @group Dwg_Entity_POLYLINE_3D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_3D) instance.
   * @returns Returns the number of points in one Dwg_Entity_POLYLINE_3D.
   */
  dwg_entity_polyline_3d_get_numpoints(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_3d_get_numpoints(ptr).data;
  }
  /**
   * Returns points in Dwg_Entity_POLYLINE_3D.
   * @group Dwg_Entity_POLYLINE_3D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_3D) instance.
   * @returns Returns points in one Dwg_Entity_POLYLINE_3D.
   */
  dwg_entity_polyline_3d_get_points(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_3d_get_points(ptr).data;
  }
  /**
   * Returns vertices in Dwg_Entity_POLYLINE_3D.
   * @group Dwg_Entity_POLYLINE_3D Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_POLYLINE_3D) instance.
   * @returns Returns vertices in one Dwg_Entity_POLYLINE_3D.
   */
  dwg_entity_polyline_3d_get_vertices(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_polyline_3d_get_vertices(ptr).data;
  }
  /**
   * Returns attributes associated with INSERT entity.
   * @group Dwg_Entity_INSERT Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Entity_INSERT) instance.
   * @returns Returns attributes associated with INSERT entity.
   */
  dwg_entity_insert_get_attribs(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_entity_insert_get_attribs(ptr).data;
  }
  /**
   * Returns texts in Dwg_Object_DICTIONARY.
   * @group Dwg_Object_DICTIONARY Methods
   * @param ptr Pointer to one Dwg_Object (not Dwg_Object_DICTIONARY) instance.
   * @returns Returns texts in one Dwg_Object_DICTIONARY.
   */
  dwg_object_dictionary_get_texts(ptr) {
    const wasmInstance = this.wasmInstance;
    return wasmInstance.dwg_object_dictionary_get_texts(ptr).data;
  }
  static createByWasmInstance(wasmInstance) {
    return this.instance == null ? new _LibreDwg(wasmInstance) : this.instance;
  }
  static async create(filepath) {
    const wasmInstance = filepath == null ? await createModule() : await createModule({
      locateFile: (filename) => {
        return `${filepath}/${filename}`;
      }
    });
    return this.createByWasmInstance(wasmInstance);
  }
};
__publicField(_LibreDwg, "instance");
let LibreDwg = _LibreDwg;
export {
  DwgAttachmentPoint,
  DwgBoundaryPathEdgeType,
  DwgBoundaryPathTypeFlag,
  DwgCodePage,
  DwgDictionaryCloningFlags,
  DwgDimensionTextHorizontal,
  DwgDimensionTextLineSpacing,
  DwgDimensionTextVertical,
  DwgDimensionToleranceTextVertical,
  DwgDimensionType,
  DwgDimensionZeroSuppression,
  DwgDimensionZeroSuppressionAngular,
  DwgHatchAssociativity,
  DwgHatchBoundaryAnnotation,
  DwgHatchGradientColorFlag,
  DwgHatchGradientFlag,
  DwgHatchPatternType,
  DwgHatchSolidFill,
  DwgHatchStyle,
  DwgPolylineFlag,
  DwgProxyOriginalDataFormat,
  DwgSmoothType,
  DwgTextGenerationFlag,
  DwgTextHorizontalAlign,
  DwgTextVerticalAlign,
  DwgThumbnailImageType,
  Dwg_Color_Method,
  Dwg_Error,
  Dwg_File_Type,
  Dwg_Hatch_Edge_Type,
  Dwg_Object_Supertype,
  Dwg_Object_Type,
  Dwg_Object_Type_Inverted,
  HEADER_VARIABLES,
  LibreDwg,
  default2 as createModule,
  dwgCodePageToEncoding,
  dwgVersions
};
