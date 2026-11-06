# KALYTH — 3D Coin Design & Animation Specification

## 1. Objective

Redesign the existing 3D cryptocurrency coin in KALYTH.

The current implementation uses Three.js (r170) inside:

`<div class="three-mount" aria-hidden="true">`

The existing canvas:

`<canvas data-engine="three.js r170" class="three-canvas">`

The objective is to create a premium, realistic, historically inspired 3D coin with two distinct faces.

The coin must feel like a genuine collectible cryptocurrency coin, not a flat circular object with images attached.

## 2. Coin Concept

The coin has two faces:

### A. Front Face — KALYTH Identity

The front side represents the identity of KALYTH.

Requirements:
- Preserve the existing KALYTH coin artwork or logo.
- Use the existing image asset if available.
- Do not redesign or distort the original logo.
- Integrate the artwork naturally into the coin surface.
- Add subtle embossed or engraved detailing where appropriate.
- Maintain a clean, symmetrical composition.
- Make the logo the primary visual focus.

### B. Back Face — Historical Tower Clock

The reverse side features an elegant analog clock inspired by the historical clock architecture of London's Elizabeth Tower (commonly associated with Big Ben).

This is the most important design requirement.

The clock must look like an antique architectural clock integrated into a luxurious commemorative coin.

Design characteristics:

**Clock face:**
- Circular, symmetrical clock dial.
- Elegant Roman numerals (I–XII).
- Distinctive and refined clock hands.
- Detailed central clock mechanism.
- Thin concentric decorative rings.
- Subtle engraved ornaments.
- Balanced spacing between numerals.
- Historically inspired clock typography.

**Architectural character:**
- Inspired by the historic London tower clock.
- Victorian and neo-Gothic design influences.
- Refined ornamental details.
- Classical European craftsmanship.
- A sense of heritage, permanence, and prestige.

Important: Do not turn the entire coin into a miniature clock tower. The main object must remain a circular coin with a clock dial integrated into its reverse face.

Avoid:
- Ordinary modern wall-clock designs.
- Cheap-looking clock graphics.
- Oversized decorative elements.
- Excessive ornaments.
- Cartoonish Roman numerals.
- Unbalanced clock hands.
- Flat designs without depth.

## 3. Physical Coin Construction

Create a realistic 3D coin using Three.js.

**Geometry:**
- Circular cylindrical coin body.
- Realistic thickness.
- Rounded or beveled outer edges.
- Clearly visible front and reverse surfaces.
- Detailed outer rim.
- Optional reeded edge (fine vertical grooves around the circumference).

**Materials:**
- Premium antique gold.
- Subtle brushed metal finish.
- Controlled metallic reflections.
- Realistic roughness.
- Fine engraved details.
- Natural highlights and shadows.

The front and reverse should look like two sides of the same physical object.

Do not create two disconnected flat circles.

## 4. Visual Style

Overall aesthetic:

- Historical.
- Elegant.
- Premium.
- Timeless.
- Minimalist but detailed.
- Sophisticated craftsmanship.

Use a refined combination of antique gold, bronze, and subtle dark metallic accents.

Avoid:
- Excessive glow.
- Neon effects.
- Oversaturated colors.
- Excessive gradients.
- Cheap plastic appearance.
- Unnecessary futuristic decorations.

The coin should look like a premium limited-edition cryptocurrency collectible.

## 5. 3D Rotation and Animation

Implement a smooth 3D rotation that allows the viewer to see both faces.

Requirements:
- Smooth rotation around the vertical axis.
- Natural perspective.
- Realistic coin thickness visible during rotation.
- Front and reverse faces must align correctly.
- No clipping or disappearing geometry.
- Smooth easing.
- No sudden jumps between orientations.

If the existing implementation supports mouse interaction, preserve and improve it.

Optional enhancements:
- Subtle idle rotation.
- Mouse-based rotation interaction.
- Smooth transition between front and reverse.
- Subtle lighting changes during rotation.

Avoid excessive spinning or distracting animation.

## 6. Reverse Clock Animation

The clock hands may move subtly to create a sense of life.

Requirements:
- Proper pivot points at the center of the dial.
- Correct hand proportions.
- Smooth and realistic rotation.
- Hands must remain attached to the clock face.
- Avoid excessive movement.

The clock must remain visually readable.

## 7. Lighting and Rendering

Use professional 3D lighting:

- Soft key light.
- Subtle fill light.
- Controlled rim lighting.
- Realistic metallic reflections.
- Appropriate shadow depth.
- Balanced contrast.

Ensure the coin remains readable against the existing KALYTH website background.

Do not introduce excessive lighting effects that make the coin look artificial.

## 8. Technical Requirements

- Use the existing Three.js r170 implementation.
- Inspect the current geometry, materials, textures, and animation logic before modifying anything.
- Reuse the existing renderer and canvas.
- Do not create unnecessary additional renderers.
- Preserve the existing `.three-mount` container.
- Preserve existing page layout and positioning.
- Maintain responsive rendering.
- Handle device pixel ratio appropriately.
- Avoid unnecessary geometry complexity.
- Dispose of unused geometries, materials, and textures.
- Avoid memory leaks.
- Maintain smooth rendering performance.

Do not replace Three.js with another rendering library.

## 9. Quality Assurance

After implementation, verify:

1. Front face displays the original KALYTH artwork correctly.
2. Reverse face displays the historical analog clock.
3. Both faces belong to the same physical coin.
4. Coin thickness is visible during rotation.
5. Coin edges have realistic details.
6. Clock numerals and hands are correctly positioned.
7. Rotation is smooth.
8. No texture distortion.
9. No z-fighting between surfaces.
10. No geometry clipping.
11. No JavaScript console errors.
12. Responsive rendering works correctly.

## 10. Final Design Direction

The final result should resemble a premium historical commemorative coin combined with a cryptocurrency identity.

The front represents KALYTH.

The reverse represents time, history, heritage, and permanence through an elegant London-inspired architectural clock.

The coin must feel like a carefully manufactured physical object with realistic metallic depth and fine craftsmanship.

**Highest priorities:**
1. Beautiful reverse clock design.
2. Realistic physical coin construction.
3. Correct 3D rotation.
4. Preservation of original KALYTH artwork.
5. Elegant and premium visual presentation.