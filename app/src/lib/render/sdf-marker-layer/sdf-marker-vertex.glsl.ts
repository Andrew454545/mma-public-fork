export default /* glsl */ `\
#version 300 es
#define SHADER_NAME sdf-marker-layer-vertex-shader

in vec3 positions;

in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec4 instanceFillColors;
in float instanceAngles;

out vec4 vFillColor;
out vec2 unitPosition;
out float outerRadiusPixels;

vec2 rotate_by_angle(vec2 vertex, float angle) {
  float angle_radian = angle * PI / 180.0;
  float cos_angle = cos(angle_radian);
  float sin_angle = sin(angle_radian);
  mat2 rotationMatrix = mat2(cos_angle, -sin_angle, sin_angle, cos_angle);
  return rotationMatrix * vertex;
}

void main(void) {
  // Hidden marker (selected/active, drawn elsewhere): emit nothing.
  if (instanceFillColors.a == 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  geometry.worldPosition = instancePositions;

  outerRadiusPixels = sdfMarker.radiusPixels;

  float edgePadding = (outerRadiusPixels + SMOOTH_EDGE_RADIUS) / outerRadiusPixels;

  unitPosition = edgePadding * positions.xy;
  geometry.uv = unitPosition;

  vec2 pixelOffset = edgePadding * positions.xy * outerRadiusPixels;
  pixelOffset = rotate_by_angle(pixelOffset, instanceAngles);
  pixelOffset.y *= -1.0;
  if (sdfMarker.shapeType == 2) {
    pixelOffset.y += 0.9 * outerRadiusPixels;
  }

  gl_Position = project_position_to_clipspace(instancePositions, instancePositions64Low, vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vec3 offset = vec3(pixelOffset, 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  gl_Position.xy += project_pixel_size_to_clipspace(offset.xy);

  // Draw-order depth in the far half (0, 1) of NDC: higher order = closer, and every
  // marker sits behind z=0, where all non-marker layers draw (so later painter's-order
  // overlays still cover markers, while marker-vs-marker resolves by order).
  float order = sdfMarker.orderBase + float(gl_InstanceID);
  gl_Position.z = ((sdfMarker.orderTotal - order) / (sdfMarker.orderTotal + 1.0)) * gl_Position.w;

  vFillColor = vec4(instanceFillColors.rgb, instanceFillColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vFillColor, geometry);
}
`;
