import { hyphenateSync } from "hyphen/en";

const unwrap = (text: string) => text.replaceAll("\n", " ");
export const paragraphs = [
  `I call our world Flatland, not because we call it so, but to make its nature clearer to you, my
happy readers, who are privileged to live in Space.`,
  `Imagine a vast sheet of paper on which straight Lines, Triangles, Squares, Pentagons, Hexagons,
and other figures, instead of remaining fixed in their places, move freely about, on or in the
surface, but without the power of rising above or sinking below it, very much like
shadows\u00A0—\u00A0only hard with luminous edges\u00A0—\u00A0and you will then have a pretty
correct notion of my country and countrymen. Alas, a few years ago, I should have said “my
universe”:\u00A0but now my mind has been opened to higher views of things.`,
  `In such a country, you will perceive at once that it is impossible that there should be anything
of what you call a “solid” kind; but I dare say you will suppose that we could at least distinguish
by sight the Triangles, Squares, and other figures, moving about as I have described them. On the
contrary, we could see nothing of the kind, not at least so as to distinguish one figure from
another. Nothing was visible, nor could be visible, to us, except Straight Lines; and the necessity
of this I will speedily demonstrate.`,
  `Place a penny on the middle of one of your tables in Space; and leaning over it, look down upon
it. It will appear a circle.`,
  `But now, drawing back to the edge of the table, gradually lower your eye (thus bringing yourself
more and more into the condition of the inhabitants of Flatland), and you will find the penny
becoming more and more oval to your view, and at last when you have placed your eye exactly on the
edge of the table (so that you are, as it were, actually a Flatlander) the penny will then have
ceased to appear oval at all, and will have become, so far as you can see, a straight line.`,
  `The same thing would happen if you were to treat in the same way a Triangle, or a Square, or any
other figure cut out from pasteboard. As soon as you look at it with your eye on the edge of the
table, you will find that it ceases to appear to you as a figure, and that it becomes in appearance
a straight line. Take for example an equilateral Triangle\u00A0—\u00A0who represents with us a
Tradesman of the respectable class. Figure\u00A01 represents the Flatland Tradesman as you would
see him while you were bending over him from above; figures\u00A02 and 3 represent the Tradesman,
as you would see him if your eye were close to the level, or all but on the level of the table; and
if your eye were quite on the level of the table (and that is how we see him in Flatland) you would
see nothing but a straight line.`,
].map((s) => hyphenateSync(unwrap(s)));
