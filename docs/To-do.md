apologies for the disorganized list here. normally i would have ite better arranged by topic
but this built up of a while and i figured you're actually better geared for sorting the list than my brain is, so .....
if you could organize and formalize this into a plan, that'd be spectacular.

significant changes:

pop-out and snap-right for preview section:
--running out of vertical screen constantly trying to navigate the app with multiple layers in place.  need a button to "snap the preview to the right of the existing stack of sections and another to pop-out to a second window. 





"re-sizing" video segments >
currently short segments lose even their handlebars when the clip is too short to fit them, this is to keep the segments aligned with playhead.
currently there's no way to specify whether you'd like to change the timeline start/stop points and the video segment's internal left/right trim when dragging a handlebar. 

this is what i'm proposing that could alleviate all of that, and it's somewhat complicated but shouldn't be difficult to do. 

i'd like the handlebars to appear only when you're hovering over that segment and therefore can be drawn directly outside the segment, therefore not requiring any minimum video segment length to use them. 

i'd also like for holding the ALT key to change the way those handlebars are drawn slightly and have that change the internal clip's left/right trim when dragged.  
with normal (non-alt) behavior being to change the punch-in/punch-out on the timeline, but automatically also adjusting the clip's internal left/right when necessary to accomodate the change. 

(example: if you were to drag the right handlebar left, it would reduce both the punch-out and the right trim.  then if you were to drag that same handlebar to the right, it would ONLY change the punch-out, causing the fill mode to determine how the gap beteween the right trim and the punch-out is generated.)

one more small item to add would be semitransparent layer effectively changing the shading of the segment showing how it's internal left/right trim sits inside it's position on the timeline.  so if it's going through 2 iterations (in loop mode) to fill the segments width, then only half the segment would be shaded.



Glow effect issues on layers
Currently, the glow effect is applied based on the shadow and outline.  each effect doesn't seem to be applied.  If i have a green glow effect and a yellow shadow effect, the glow is only green if the shadow is zero.  as soon as the shadow is even 1 pixel in size, the entire glow color changes to the shadow color. 

would like to move the layer property control panel to above the layers, so it's always on top, directly under teh buttons used to add new layers. 

When switching layer types, the changes aren't auto-saving (and therefore not updating the preview)

when clicking "duplicate" on a layer, it would be preferable to automatically select the newly created record. 

i really like how you opted to use the primary color selected for each layer as the background color of the selected layer. could we also outline the selected layer with the outline color just to make it really apparent?

when collapsing the preview section, the preview disappears when expanded again.  you must resize the entire window to get the preview to return. 

we need to organize the controls for the layer properties and either add group boxes, lines separating, or even a tab-like (well, tabs.. just not with teh old fashiioned looking rounded tab headers).
--categories would be something like:
----"Type" (by itself)
----"Position" (which includes size)
----"Appearance" (color, glow, shadow)
----"Layer-specific" (need a better label name than that, but meaning "everything that wasn't one of those globally classified properties")


the mirrorX and mirrorY aren't working quite right either, they're not supposed to double, it's supposed to take the top half and mirror that for the bottom (or in quarters), completely hiding what would've originally been there. maing a kaleidescope type of effect. 

low cut and high cut on the spectrogram should also change what the frequency range displayed is, not just the audio frequencies recognized during analysis. 

if using an outline around an image layer with an image that's got a transparent background, the outline is around the entire height/width of the image dimensions and not around the image. you could use an additional glow for this and keep it at 100% opacity with no external fade. because glow works fine here already. 

spectrograms:

need a "cutout" property that can determine the size of the internal opening when in circle mode 
need a "bar height/line height/dot size" property that allows scaling of the audio responsiveness without changing the dimensions of the object. 

currently, the render button is outside the trial/lock banner, that should be the orientation button that's still available while in trial mode.  render shouldn't be avilable. 
and if you can make the trail banner just a tiny bit transparent, so we can see there are icons hidden under it to be unlocked, that would be awesome. 



