import ctypes as ct
from freetype import FT_Face

import cairo

CAIRO_STATUS_SUCCESS = 0
FT_Err_Ok = 0

_freetype_so = ct.CDLL("libfreetype.so.6")
_cairo_so = ct.CDLL("libcairo.so.2")
_cairo_so.cairo_ft_font_face_create_for_ft_face.restype = ct.c_void_p
_cairo_so.cairo_ft_font_face_create_for_ft_face.argtypes = [ct.c_void_p, ct.c_int]
_cairo_so.cairo_font_face_get_user_data.restype = ct.c_void_p
_cairo_so.cairo_font_face_get_user_data.argtypes = (ct.c_void_p, ct.c_void_p)
_cairo_so.cairo_font_face_set_user_data.argtypes = (
    ct.c_void_p,
    ct.c_void_p,
    ct.c_void_p,
    ct.c_void_p,
)
_cairo_so.cairo_set_font_face.argtypes = [ct.c_void_p, ct.c_void_p]
_cairo_so.cairo_font_face_status.argtypes = [ct.c_void_p]
_cairo_so.cairo_font_face_destroy.argtypes = (ct.c_void_p,)
_cairo_so.cairo_status.argtypes = [ct.c_void_p]

_ft_lib = ct.c_void_p()
status = _freetype_so.FT_Init_FreeType(ct.byref(_ft_lib))
if status != FT_Err_Ok:
    raise RuntimeError("Error %d initializing FreeType library." % status)


class PycairoContext(ct.Structure):
    _fields_ = [
        ("PyObject_HEAD", ct.c_byte * object.__basicsize__),
        ("ctx", ct.c_void_p),
        ("base", ct.c_void_p),
    ]


def create_cairo_font_face_for_ft_face(cairo_ctx: cairo.Context, ft_face: FT_Face, loadoptions=0):
    # create Cairo font face for freetype face
    cr_face = _cairo_so.cairo_ft_font_face_create_for_ft_face(ft_face, loadoptions)
    status = _cairo_so.cairo_font_face_status(cr_face)
    if status != CAIRO_STATUS_SUCCESS:
        raise RuntimeError("Error %d creating cairo font face" % status)

    # set Cairo font face into Cairo context
    cairo_t = PycairoContext.from_address(id(cairo_ctx)).ctx
    cairo_ctx.save()
    _cairo_so.cairo_set_font_face(cairo_t, cr_face)
    status = _cairo_so.cairo_font_face_status(cairo_t)
    if status != CAIRO_STATUS_SUCCESS:
        cairo_ctx.restore()
        raise RuntimeError("Error %d creating cairo font face" % status)

    # get back Cairo font face as a Python object
    face = cairo_ctx.get_font_face()
    cairo_ctx.restore()

    # TODO: does this take a reference to the underlying FT_Face?
    return face
