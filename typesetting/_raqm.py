import ctypes


class RaqmGlyph(ctypes.Structure):
    _fields_ = [
        ("index", ctypes.c_uint),
        ("x_advance", ctypes.c_int),
        ("y_advance", ctypes.c_int),
        ("x_offset", ctypes.c_int),
        ("y_offset", ctypes.c_int),
        ("cluster", ctypes.c_uint32),
        ("face", ctypes.c_void_p),
    ]


_raqm = ctypes.cdll.LoadLibrary("libraqm.so.0")
_raqm.raqm_create.restype = ctypes.c_void_p
_raqm.raqm_destroy.argtypes = [ctypes.c_void_p]
_raqm.raqm_set_text_utf8.restype = ctypes.c_bool
_raqm.raqm_set_text_utf8.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
_raqm.raqm_set_freetype_face.restype = ctypes.c_bool
_raqm.raqm_set_freetype_face.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
_raqm.raqm_layout.restype = ctypes.c_bool
_raqm.raqm_layout.argtypes = [ctypes.c_void_p]
_raqm.raqm_get_glyphs.restype = ctypes.c_void_p
_raqm.raqm_get_glyphs.argtypes = [ctypes.c_void_p]
_raqm.raqm_add_font_feature.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
_raqm.raqm_add_font_feature.restype = ctypes.c_bool


class Raqm:
    def __init__(self):
        self._raqm = _raqm.raqm_create()

    def set_text(self, text):
        return self.set_text_utf8(text.encode("utf8"))

    def set_text_utf8(self, encoded_text):
        return _raqm.raqm_set_text_utf8(self._raqm, encoded_text, len(encoded_text))

    def set_freetype_face(self, face):
        if hasattr(face, "_FT_Face"):
            face = face._FT_Face
        return _raqm.raqm_set_freetype_face(self._raqm, face)

    def add_font_feature(self, feature):
        encoded_feature = feature.encode("utf8")
        return _raqm.raqm_add_font_feature(self._raqm, encoded_feature, len(encoded_feature))

    def layout(self):
        return _raqm.raqm_layout(self._raqm)

    def get_glyphs(self):
        length = ctypes.c_size_t(0)
        glyphs = _raqm.raqm_get_glyphs(self._raqm, ctypes.byref(length))

        if glyphs is not None:
            return (RaqmGlyph * length.value).from_buffer_copy(
                (RaqmGlyph * length.value).from_address(glyphs)
            )
        return None

    def __del__(self):
        if self._raqm:
            _raqm.raqm_destroy(self._raqm)
