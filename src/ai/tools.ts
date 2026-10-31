import { outline } from "./outline";
import { componentsIn } from "../document/components";
import { lookAtDesign, lookAtImage } from "./vision";
import { lookAtAttachment } from "./pictures";
import { checkLayout } from "./designCheck";
import { checkExport } from "./exportCheck";
import { commandLabel, newId, runCommand } from "../commands";
import type { CommandName } from "../commands";
import { measureText } from "../canvas/text";
import { extractPayload } from "../document/clipboard";
import { canMask, canTurn, worldBounds } from "../document/geometry";
import { defaultLayout } from "../document/layout";
import { outlineFromData } from "../document/path";
import { ENTRANCES, sceneOf } from "../document/time";
import { MOVING, emptyDoc } from "../document/types";
import { GRADE_CONTROLS, canGrade, gradeChanges } from "../document/grade";
import { readings as gradeReadings } from "../canvas/grade";
import type { Doc, El } from "../document/types";
import { invoke } from "@tauri-apps/api/core";
import { addPicture, mimeFor, pictureOf, preloadPictures } from "../project/assets";
import { renderPng } from "../project/exporter";
import { clipPicture, clipPictureOf, fileLength, letGoOfOriginals, seekClips } from "../video/clips";
import { QUALITIES, defaultChoice, exportScene } from "../video/scene";
import { saveNow, tabName } from "../project/project";
import { setLayout } from "../ui/layout";
import { tracePicture } from "../project/trace";
import { getState, goTo, keepAiWorkWhile, liveRoom, parkedFiles, roomFor } from "../state/store";
import type { Room } from "../state/store";
import { parentOf } from "../state/directions";
import { addMsg, askDesigner, conversationProject, getChat, messagesOf, setMinimized, taskOf, updateMsg } from "./chat";
import { outsideRules, skillsText } from "./rules";
import { isOutside } from "./who";
import { getSkills, keepTaughtSkill } from "./skills";

/**
 * What an agent can do in Duet. These are the same commands the interface uses.
 * The designer's permission level is enforced here, not left to the agent's good manners.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  /** A picture to show the AI, as base64. */
  image?: { data: string; mime: string };
  isError?: boolean;
}

const str = { type: "string" };
const num = { type: "number" };
const ids = { type: "array", items: str, description: "Element ids, from get_document." };
const props = {
  type: "object",
  description:
    "Any of: name, x, y, width, height (numbers, in pixels), fill (hex colour like #1b1b1f), stroke (hex colour, or null for none), strokeWidth, radius (corner radius), opacity (0 to 1), blend (normal, multiply, screen, overlay, soft-light, darken, lighten or add; screen makes black clear, for a black and white mist or light clip over a scene), component (true to make this something that can be reused: place copies of it with create_instance, and changing it changes every copy), rotation (degrees, clockwise, around its own middle; on a group it turns everything inside together; frames and copies of components cannot be turned), d (a path only: redraw its outline, as SVG path text measured from the corner of its parent frame), text, fontSize, fontFamily (any installed font name, or empty for the system font), fontWeight (300 to 900, 400 is regular, 700 is bold), textAlign (left, center or right), lineHeight (a multiple of the size, like 1.4), letterSpacing (pixels), textFixed (true to keep the width and wrap words), shadow ({x, y, blur, color} or null), gradient ({from, to, angle in degrees, 90 runs top to bottom} or null, replaces the fill), link (id of a frame to open when this is clicked in Present mode, or null), linkKind (empty to go to that screen, overlay to open it on top, back to go back), transition (empty, dissolve, push-left, push-right, push-up or push-down), transitionMs (milliseconds, 300 if 0), scroll (on a screen: true so that what is below its bottom edge can be scrolled in Present mode), layout (frames only: auto layout that lines up the children, as {dir is row or column, gap, padX, padY, align is start, center, end or stretch, justify is start, center, end or between, hug true or false}, or null to turn it off; children are placed in their layer order), locked (true to stop it being picked on the canvas), hidden (true to hide it: not drawn, picked or exported; false to show it again), grow (inside an auto layout frame: 1 to fill the free space along the direction, 0 to keep its size).",
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_context",
    description:
      "Start here. Returns the project, what the designer has selected, the frames on the page, the permission level, which skills are loaded, and the comments the designer pinned on the canvas. Each comment is feedback about that exact spot: look at the thing under it with look_at_design before you change it.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "work_in_project",
    description:
      "For an AI connected from outside Duet's own chat: choose which open project you work in, by its tab name. You stay in it whichever tab the designer looks at, until you choose another or it is closed. Leave name out to list the open projects. Without this you work in the project that was on screen when you started.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "The project's name, as on its tab." } } },
  },
  {
    name: "get_working_rules",
    description:
      "How to work in Duet, and the skills the designer has turned on, in full. For an AI connected from outside Duet's own chat: call it once before your first change in a job. Duet's own chat already gives you this, so do not call it from there.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_outline",
    description:
      "A short outline of the design: every thing with its id, position, size, and the few properties that matter, indented to show what is inside what. Much cheaper to read than get_document, so use this first. Pass ids to outline only those things and what is inside them.",
    inputSchema: { type: "object", properties: { ids } },
  },
  {
    name: "get_document",
    description:
      "The full, exact data for every element on the page. It is large, so prefer get_outline and use this only when you need a property the outline does not show. x and y are relative to the parent frame, or to the page for top-level things. Order in childIds and rootIds goes back to front.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "look_at_image",
    description:
      "See a picture the designer placed on the canvas (type image in get_document). You cannot see pictures unless you call this, and you must not guess what is in one. The picture is shrunk first, so call it once per picture and then work from what you saw. maxSize is the longest side in pixels (default 768).",
    inputSchema: { type: "object", properties: { id: str, maxSize: num }, required: ["id"] },
  },
  {
    name: "look_at_attachment",
    description:
      "See a picture, or read a text file, the designer attached to a chat message, such as a screenshot of feedback, a reference or a written brief. get_context lists them as attachedPictures, each with a number. They are not on the canvas. Look at each new one once, before you act on the message it came with.",
    inputSchema: { type: "object", properties: { number: { type: "number", description: "The picture's number from attachedPictures." } }, required: ["number"] },
  },
  {
    name: "look_at_design",
    description:
      "See what a frame or shape looks like right now, drawn as the designer sees it. Use it to check your own work after changes, and to understand a design before you change it. Leave ids out to see the selection, or the first frame. maxSize is the longest side in pixels (default 768).",
    inputSchema: { type: "object", properties: { ids, maxSize: num } },
  },
  {
    name: "create_instance",
    description:
      "Place a live copy of a component (listed as components in get_context). The copy follows the original. To change one copy, use set_props on things inside it; to change every copy, change the original.",
    inputSchema: {
      type: "object",
      properties: { componentId: str, x: num, y: num, parentId: { type: "string", description: "A frame to put it in. Leave out for the page." } },
      required: ["componentId", "x", "y"],
    },
  },
  {
    name: "mark_working_area",
    description:
      "Before you make something new, claim the space it will take on the page, so the designer sees where you are working while you think and build. x, y, width and height are page pixels. Pick free space (get_outline shows what is where). Call it again if your plan moves.",
    inputSchema: { type: "object", properties: { x: num, y: num, width: num, height: num }, required: ["x", "y", "width", "height"] },
  },
  {
    name: "select_elements",
    description: "Select elements so the designer can see which things you are talking about. Pass an empty list to clear.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
  {
    name: "create_element",
    description:
      "Add a frame, rectangle, ellipse, text or path. x and y are relative to parentId (a frame), or to the page when parentId is left out. For text, put the words in props.text and leave width and height out so they fit the words. A path is any shape you draw yourself, like a leaf, a petal, a wave or an arch: give its outline in d and leave width and height out. A closed outline (ending in Z) is filled with props.fill and has no line around it; give props.stroke a colour to add one. A path is one unbroken outline with no holes, so use several paths for several pieces.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["frame", "rect", "ellipse", "text", "path"] },
        x: num,
        y: num,
        width: num,
        height: num,
        d: {
          ...str,
          description:
            "For a path: the outline as SVG path text, like M 0 0 C 30 -40 70 -40 100 0 C 70 40 30 40 0 0 Z. M, L, H, V, C, S, Q, T, A and Z work, in capital or small letters. The numbers are pixels measured from x, y, so you can draw a shape once around 0 0 and place it anywhere.",
        },
        parentId: { ...str, description: "A frame to put it in. Leave out for the page." },
        props,
      },
      required: ["type", "x", "y"],
    },
  },
  {
    name: "create_elements",
    description:
      "Add many things at once, as one step. Use this to build a whole screen or section in ONE call, instead of one create_element call per thing. Send one frame as the single top level element and put everything inside it in its children, each child with x and y relative to that frame. Each element takes the same fields as create_element (type, x, y, width, height, d, props). A child that is a frame can have its own children. The result lists the id of every element made. Example: {\"elements\":[{\"type\":\"frame\",\"x\":0,\"y\":0,\"width\":360,\"height\":640,\"props\":{\"fill\":\"#ffffff\"},\"children\":[{\"type\":\"text\",\"x\":24,\"y\":80,\"props\":{\"text\":\"Welcome back\",\"fontSize\":28,\"fontWeight\":700}},{\"type\":\"rect\",\"x\":24,\"y\":160,\"width\":312,\"height\":48,\"props\":{\"fill\":\"#f1f1f4\",\"radius\":8}}]}]}",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { ...str, description: "A frame to put the top level elements in. Leave out for the page." },
        elements: {
          type: "array",
          description: "The things to add. Usually one frame whose children hold everything else.",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["frame", "rect", "ellipse", "text", "path"] },
              x: num,
              y: num,
              width: num,
              height: num,
              d: str,
              props,
              children: { type: "array", description: "Elements inside this frame, same shape as this one. x and y are relative to this frame.", items: { type: "object" } },
            },
            required: ["type", "x", "y"],
          },
        },
      },
      required: ["elements"],
    },
  },
  {
    name: "place_image",
    description:
      "Put a picture file from this computer onto the canvas, such as a photo or a reference the designer told you about. path is the full path to a PNG, JPG, GIF, WebP or SVG file (~ for the home folder works). Leave width and height out to keep its shape at up to 640 pixels on the longer side, or give one of them to set the size and keep the shape. The designer may be asked to allow it. You still cannot see the picture: call look_at_image with the new id if you need to.",
    inputSchema: {
      type: "object",
      properties: {
        path: str,
        x: num,
        y: num,
        width: num,
        height: num,
        parentId: { ...str, description: "A frame to put it in. Leave out for the page." },
        name: { ...str, description: "What to call it in the layers list. Leave out to use the file name." },
      },
      required: ["path", "x", "y"],
    },
  },
  {
    name: "set_props",
    description: "Change properties of one or more elements.",
    inputSchema: { type: "object", properties: { ids, props }, required: ["ids", "props"] },
  },
  {
    name: "duplicate_elements",
    description:
      "Make a copy of things and everything inside them, next to the original, so you can try another version and the first one stays. Use this to make a variation, never delete and rebuild. A screen is placed beside the original; give dx and dy to put the copy somewhere else, and parentId to copy into another frame (leave it out to stay where the original is). The result lists each new id beside the one it copies.",
    inputSchema: {
      type: "object",
      properties: { ids, dx: num, dy: num, parentId: { type: "string", description: "A frame to put the copies in. Leave out to keep them where the original is." } },
      required: ["ids"],
    },
  },
  {
    name: "move_elements",
    description: "Move elements by dx and dy pixels.",
    inputSchema: { type: "object", properties: { ids, dx: num, dy: num }, required: ["ids", "dx", "dy"] },
  },
  {
    name: "resize_element",
    description: "Set the position and size of one element. x and y are relative to its parent.",
    inputSchema: {
      type: "object",
      properties: { id: str, x: num, y: num, width: num, height: num },
      required: ["id", "x", "y", "width", "height"],
    },
  },
  {
    name: "reparent_elements",
    description:
      "Move elements into a frame, or out to the page. They stay where they look. index is the place in the stack, later is in front.",
    inputSchema: {
      type: "object",
      properties: { ids, parentId: { ...str, description: "Frame id, or leave out for the page." }, index: num },
      required: ["ids"],
    },
  },
  {
    name: "trace_image",
    description:
      "Turn a picture on the canvas into flat drawn shapes that follow its outline, laid exactly over it, so a leaf, a logo or a silhouette becomes something you can recolour, reshape and turn. It works only on pictures with a plain or see-through background. Each separate part becomes one path in its average colour, and holes are filled in. The picture stays where it is. Look at the picture first if you are not sure it is suitable.",
    inputSchema: { type: "object", properties: { id: { ...str, description: "The picture to trace." } }, required: ["id"] },
  },
  {
    name: "make_mask",
    description:
      "Show things only inside a shape, for example a photo cut to the outline of a leaf or a circle. shapeId is a rectangle, an ellipse or a closed path. ids are the things to show through it, such as pictures. They must all sit in the same frame as the shape. They are put together in a group. The shape is no longer drawn, it only decides where the others show. Move or resize a thing inside the group to change which part of it shows.",
    inputSchema: { type: "object", properties: { shapeId: { ...str, description: "The shape to show them through." }, ids }, required: ["shapeId", "ids"] },
  },
  {
    name: "set_duration",
    description:
      "Make a frame on the page play like a video, or change how long it plays. Everything in the frame is then seen over time: use set_timing for when a thing shows, set_entrance for a ready-made arrival, animate for any other movement, and place_video for clips. The frame's size is the size of the video (1920 by 1080 for wide, 1080 by 1920 for tall). Things later in the frame's list are in front. seconds 0 makes it a still design again.",
    inputSchema: { type: "object", properties: { id: { ...str, description: "A frame on the page." }, seconds: num }, required: ["id", "seconds"] },
  },
  {
    name: "set_timing",
    description:
      "When things show inside a frame that plays: the second they appear and the second they leave, counted from the start of the frame. end 0 means to the end of the frame. Whatever they do over time moves along with them. For a video clip, clipFrom is the second in its file where playing starts.",
    inputSchema: { type: "object", properties: { ids, start: num, end: num, clipFrom: num }, required: ["ids"] },
  },
  {
    name: "set_entrance",
    description: "A ready-made way for things to arrive when they appear (when: in) or go when they leave (when: out). kind is none, fade, slide-left, slide-right, slide-up, slide-down or grow. seconds is how long it takes, 0.4 if left out. Set the timing first.",
    inputSchema: { type: "object", properties: { ids, when: { ...str, description: "in or out." }, kind: str, seconds: num }, required: ["ids", "when", "kind"] },
  },
  {
    name: "animate",
    description:
      "Make one property of one thing change over time, inside a frame that plays. prop is x, y, width, height, opacity or rotation. keys is the whole list of moments for that property, replacing what was there: each has t (seconds from the start of the frame), v (the value then) and ease (linear, in, out or in-out, which is used if left out; it shapes the way into that moment). x and y are relative to the parent, like everywhere else. Before the first moment the first value holds, after the last the last holds. An empty list makes it stay as it is. Give several calls for several properties.",
    inputSchema: {
      type: "object",
      properties: { id: str, prop: str, keys: { type: "array", items: { type: "object", properties: { t: num, v: num, ease: str }, required: ["t", "v"] } } },
      required: ["id", "prop", "keys"],
    },
  },
  {
    name: "set_curve",
    description:
      "Shape how fast a move goes, for things that already change over time. t is the second the move ends at (a moment made with animate; the first moment of a property has no move arriving at it). shape is a ready one: steady (the same speed all the way), gentle (slow, quick, slow), snappy (fast start, soft landing) or bouncy (goes a little past, then settles). Or give shape as four numbers [x1, y1, x2, y2], the two handles of a speed graph: x is time from 0 to 1, y is how far along the move is, and y above 1 goes past the end. Moves are gentle unless you change them.",
    inputSchema: {
      type: "object",
      properties: { ids, props: { type: "array", items: str, description: "x, y, width, height, opacity or rotation." }, t: num, shape: { description: "steady, gentle, snappy, bouncy, or four numbers." } },
      required: ["ids", "props", "t", "shape"],
    },
  },
  {
    name: "place_video",
    description:
      "Put a video file from this computer into a frame that plays. path is the full path to an MP4, MOV, M4V or WebM file (~ for the home folder works). It appears at start (seconds, 0 if left out) and plays to its end, and the frame grows longer if it has to. Leave x, y, width and height out to fit it inside the frame, centred. The file stays where it is on the computer. Trim it afterwards with set_timing. The designer is asked first.",
    inputSchema: {
      type: "object",
      properties: { path: str, parentId: { ...str, description: "A frame that plays." }, start: num, x: num, y: num, width: num, height: num, name: str },
      required: ["path", "parentId"],
    },
  },
  {
    name: "place_sound",
    description:
      "Put a sound file from this computer into a frame that plays, such as music or a recorded voice. It is only heard, never seen. path is the full path to an MP3, WAV, M4A, AAC, AIFF, OGG or FLAC file (~ for the home folder works). It is heard from start (seconds, 0 if left out) until it ends or the frame ends. volume is 0 to 1, 1 if left out: use about 0.2 for music under a voice. Trim it with set_timing, change how loud it is with set_props. The designer is asked first.",
    inputSchema: { type: "object", properties: { path: str, parentId: { ...str, description: "A frame that plays." }, start: num, volume: num, name: str }, required: ["path", "parentId"] },
  },
  {
    name: "export_frame",
    description:
      "Save a frame (or any shape) as a PNG picture file on this computer, at its true size, or larger with scale (2 gives twice the pixels). path is the full path of the new file and must end in .png (~ for the home folder works). Folders are made as needed. It never replaces a file that already exists: choose a new name. The designer may be asked to allow it.",
    inputSchema: {
      type: "object",
      properties: { id: { ...str, description: "The frame or shape to save, from get_document." }, path: str, scale: { ...num, description: "1 by default. Up to 4." } },
      required: ["id", "path"],
    },
  },
  {
    name: "picture_of_duet",
    description:
      "Save a picture of the whole Duet window, as the designer sees it, for the website, docs or release notes. Duet draws it itself: the screen is not used, so it works while Duet is in the background or on another desktop. Choose what shows first: space is design, video or photo (the tools) or chat (the AI beside the projects); panel is properties or colour (the right panel in Video and Photo); select is a list of ids to pick and show whole. path is the full path of the new file and must end in .png (~ works). It never replaces a file. Use a demo project with stock pictures, never the designer's own work.",
    inputSchema: {
      type: "object",
      properties: {
        path: str,
        space: { type: "string", enum: ["design", "video", "photo", "chat"] },
        panel: { type: "string", enum: ["properties", "colour"] },
        select: { type: "array", items: str },
      },
      required: ["path"],
    },
  },
  {
    name: "export_video",
    description:
      "Make an MP4 video of a frame that plays (one with a length), with its clips and sound, exactly as the designer's Export video does. When the frame has a work area marked, only that part is made. path is the full path of the new file and must end in .mp4, or .mov for a master (~ for the home folder works); leave it out to save in Documents, Duet, Exports. It never replaces a file that already exists. fps is 24, 25, 30 (the default) or 60. size is the longer side in pixels (for example 1080 or 3840); leave it out to keep the frame's own size. quality is best, good (the default) or small. master true makes a 10-bit ProRes .mov to keep editing or grading elsewhere instead of an MP4 to share. Clips that fill the frame are read from their own files at full quality and their colour is worked out in 32-bit. The project must be the one on screen. It can take a while for a long video. The designer may be asked to allow it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...str, description: "A frame that plays, from get_document." },
        path: str,
        fps: num,
        size: { ...num, description: "The longer side in pixels. Leave out for the frame's own size." },
        quality: { type: "string", enum: ["best", "good", "small"] },
        master: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "save_skill",
    description:
      "Save rules the designer taught you as one of their own skills, so every later conversation follows them. Use it when the designer asks you to keep, learn, remember or install their rules as a skill. Write the rules in the designer's own words, one per line starting with \"- \", and keep every rule they gave, not only the latest. Saving under a name they already have brings that skill up to date, so include the old rules that still hold. The designer is always asked first.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short name, like Flat botanical silhouettes." },
        summary: { type: "string", description: "One line on what the skill is for." },
        rules: { type: "string", description: "The rules, one per line, each starting with \"- \". Headings starting with ## may group them." },
      },
      required: ["name", "rules"],
    },
  },
  {
    name: "set_grade",
    description:
      "Change the colour of pictures and video clips, like the basic panel in Premiere's Lumetri or Lightroom. The designer sees the same controls in the Colour tab. Give only the controls to change; the others keep their values. Controls: exposure (stops of light, -5 to 5, 1 is twice the light), contrast, highlights, shadows, whites, blacks, temperature (minus cooler and bluer, plus warmer and more orange), tint (minus greener, plus more magenta), saturation (-100 is black and white), vibrance (moves dull colours most and skin least), all -100 to 100 with 0 meaning no change, and lookAmount (0 to 1, how much of the look is used). Also hue (-180 to 180 degrees, turns every colour round the wheel), vignette (-100 darker edges to 100 lighter edges), skinKeep (0 to 100, skin keeps its own colour while the rest changes), skinTone (minus pinker, plus more golden, only skin) and skinLight (only skin, darker or brighter). Skin is found by its colour, so check it on warm scenes. curves is an object of point lists, each point [x, y] from 0 to 1, for example {\"light\": [[0, 0.04], [0.5, 0.55], [1, 1]]}: light, red, green and blue map brightness in to out; hueHue, hueSat and hueLight are read round the colour wheel (x is the hue: 0 red, 0.17 yellow, 0.33 green, 0.5 cyan, 0.67 blue, 0.83 magenta) where 0.5 is no change, so [[0.55, 0.5], [0.6, 0.8], [0.65, 0.5]] on hueSat makes blues richer and leaves other colours alone; lightSat is read along brightness, 0.5 is no change. An empty list takes a curve away. Send reset true to put the colour back as it was. To use a .cube look, use load_look. Work in small steps: read color_readings, change a few controls, then read again and look_at_design to check.",
    inputSchema: {
      type: "object",
      properties: {
        ids,
        grade: { type: "object", description: "The controls to change, for example {\"exposure\": -0.8, \"highlights\": -40, \"contrast\": -15}." },
        reset: { type: "boolean", description: "True to remove every colour change from these." },
      },
      required: ["ids"],
    },
  },
  {
    name: "copy_grade",
    description: "Give other pictures or clips exactly the colour of one, so a whole scene matches. fromId is the one to copy from; ids are the ones that get its colour, look included.",
    inputSchema: { type: "object", properties: { fromId: { ...str, description: "The picture or clip to copy the colour from." }, ids }, required: ["fromId", "ids"] },
  },
  {
    name: "load_look",
    description: "Use a look from a .cube LUT file on pictures or clips. Duet keeps a copy in Documents, Duet, Looks. path is the full path of the .cube file (list_looks shows the ones already kept). amount is 0 to 1, 1 if left out. The look runs after the light and white balance controls and before saturation, so fix exposure and white balance first.",
    inputSchema: { type: "object", properties: { ids, path: { ...str, description: "The full path to a .cube file, starting from the top folder or from ~." }, amount: num }, required: ["ids", "path"] },
  },
  {
    name: "list_looks",
    description: "The .cube looks already kept in Documents, Duet, Looks, with their full paths, ready for load_look.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "color_readings",
    description:
      "Numbers about how a picture or clip looks with its colour as it is now, so you can check a grade without guessing: stopsFromGrey (how far its average brightness is from middle grey, in stops; plus is too bright, around 0 to 0.5 is usual), brightness percentiles (0 to 1), blownPercent and crushedPercent (pure white and pure black), channelClipped, cast (warm plus means too orange, magenta plus means too pink, near 0 is neutral), and saturation. For a clip it reads the picture at t seconds into its frame, or where the playhead is. Send original true to read it without its colour changes. Also returns the current grade.",
    inputSchema: { type: "object", properties: { id: { ...str, description: "A picture or a clip." }, t: { ...num, description: "For a clip: seconds into its frame." }, original: { type: "boolean" } }, required: ["id"] },
  },
  {
    name: "resolve_comment",
    description:
      "Mark a comment the designer pinned on the canvas as dealt with, once you have done what it asks. get_context lists the open ones under comments, each with where it points, the thing under it and what is near. Say in reply what you did, in a few words.",
    inputSchema: { type: "object", properties: { id: str, reply: str }, required: ["id"] },
  },
  {
    name: "add_comment",
    description: "Pin a short note on the canvas for the designer, at page pixels x and y, such as a question about one spot. Use it rarely: talk in the chat first.",
    inputSchema: { type: "object", properties: { x: num, y: num, text: str }, required: ["x", "y", "text"] },
  },
  {
    name: "delete_elements",
    description: "Delete elements and everything inside them. The designer may be asked to approve this.",
    inputSchema: { type: "object", properties: { ids }, required: ["ids"] },
  },
];

const EDITS = new Set(["resolve_comment", "add_comment", "set_grade", "copy_grade", "create_instance", "create_element", "create_elements", "set_props", "duplicate_elements", "move_elements", "resize_element", "reparent_elements", "make_mask", "trace_image", "set_duration", "set_timing", "set_entrance", "animate", "set_curve"]);
/** Things the designer is asked about first in Ask first mode: losing work, and reading or writing a file on the computer. */
const RISKY = new Set(["load_look", "delete_elements", "place_image", "place_video", "place_sound", "export_frame", "export_video"]);

type Args = Record<string, unknown>;

const fail = (text: string): ToolResult => ({ text, isError: true });

function missing(list: unknown): string[] {
  const doc = R.currentDoc();
  return Array.isArray(list) ? list.filter((i) => typeof i !== "string" || !doc.elements[i]).map(String) : ["(not a list)"];
}

function nameOf(id: unknown): string {
  return typeof id === "string" ? (R.currentDoc().elements[id]?.name ?? String(id)) : String(id);
}

function namesOf(list: unknown): string {
  return Array.isArray(list) ? list.map(nameOf).join(", ") : "";
}

/** Names an agent might use for a property, and what Duet calls it. */
const PROP_ALIASES: Record<string, string> = { cornerRadius: "radius", borderRadius: "radius", backgroundColor: "fill", color: "fill", borderColor: "stroke", borderWidth: "strokeWidth", font: "fontFamily", content: "text", label: "text" };
const ELEMENT_FIELDS = new Set(["type", "x", "y", "width", "height", "d", "props", "children", "parentId"]);
let knownProps: Set<string> | null = null;
/** Every property an element has, found by making one. */
function propNames(): Set<string> {
  if (!knownProps) {
    const made = runCommand(emptyDoc(), "create_element", { id: "probe", type: "rect", x: 0, y: 0, width: 1, height: 1 });
    knownProps = new Set(Object.keys(made.elements.probe));
  }
  return knownProps;
}

/** Style fields written beside x and y count as props, so a thing is not silently left plain. A field Duet has no use for is named in the error. */
function liftProps(own: Args): { el: Args } | { error: string } {
  const el: Args = {};
  const props: Record<string, unknown> = { ...((own.props as Record<string, unknown>) ?? {}) };
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(own)) {
    if (ELEMENT_FIELDS.has(k)) el[k] = v;
    else if (PROP_ALIASES[k] && !(PROP_ALIASES[k] in props)) props[PROP_ALIASES[k]] = v;
    else if (propNames().has(k) && !(k in props)) props[k] = v;
    else if (!(k in props)) unknown.push(k);
  }
  if (unknown.length) return { error: `I do not know the field ${unknown.map((k) => `"${k}"`).join(", ")}. Style goes in props or beside x and y, using: ${[...propNames()].filter((k) => !["id", "parentId", "childIds", "overrides", "keys", "nodes"].includes(k)).join(", ")}.` };
  el.props = props;
  return { el };
}

/** Shown with every mistake in create_elements: an agent that cannot see the tool's fields learns them from its first wrong call. */
const BATCH_USAGE = ` How to call it: {"elements":[{"type":"frame","x":0,"y":0,"width":360,"height":640,"fill":"#ffffff","children":[{"type":"text","x":24,"y":80,"text":"Welcome back","fontSize":28,"fontWeight":700},{"type":"rect","x":24,"y":160,"width":312,"height":48,"fill":"#f1f1f4","radius":8}]}]}. One frame holds everything in children. Each thing needs type, x, y. x and y are from the frame's corner. Style (fill, stroke, radius, text, fontSize, fontWeight, opacity...) goes beside x and y. Never give a child a parentId.`;

/** A sentence a designer would say, for approvals and suggestions. */
export function summarise(tool: string, a: Args): string {
  switch (tool) {
    case "create_element": {
      const p = (a.props ?? {}) as Partial<El>;
      if (a.type === "path") return "Draw a shape";
      return `Add a ${a.type === "rect" ? "rectangle" : String(a.type)}${p.text ? ` that says "${p.text}"` : ""}`;
    }
    case "create_elements":
      return `Add ${Array.isArray(a.items) ? a.items.length : "several"} things`;
    case "create_instance":
      return `Place a copy of ${nameOf(a.componentId)}`;
    case "place_image":
      return `Bring in the picture at ${String(a.path)}`;
    case "export_frame":
      return `Save ${nameOf(a.id)} as a picture at ${String(a.path)}`;
    case "picture_of_duet":
      return `Save a picture of the Duet window at ${String(a.path)}`;
    case "export_video":
      return `Make a video of ${nameOf(a.id)}${a.path ? ` at ${String(a.path)}` : ", in Documents, Duet, Exports"}`;
    case "place_video":
      return `Bring in the clip at ${String(a.path)}`;
    case "place_sound":
      return `Bring in the sound at ${String(a.path)}`;
    case "set_duration":
      return Number(a.seconds) > 0 ? `Make ${nameOf(a.id)} play for ${String(a.seconds)} seconds` : `Make ${nameOf(a.id)} a still design`;
    case "set_timing":
      return `Change when ${namesOf(a.ids)} ${Array.isArray(a.ids) && a.ids.length > 1 ? "show" : "shows"}`;
    case "set_entrance":
      return `${namesOf(a.ids)}: ${a.when === "out" ? "leave" : "arrive"} with ${String(a.kind)}`;
    case "set_curve":
      return `Change how ${namesOf(a.ids)} speeds up and slows down`;
    case "animate":
      return `Change ${String(a.prop)} of ${nameOf(a.id)} over time`;
    case "trace_image":
      return `Trace ${nameOf(a.id)} into shapes`;
    case "make_mask":
      return `Show ${namesOf(a.ids)} only inside ${nameOf(a.maskId ?? a.shapeId)}`;
    case "set_props": {
      const p = (a.props ?? {}) as Record<string, unknown>;
      // a new outline is a long list of points: say what it is instead of spelling it out
      if ("nodes" in p || "d" in p) return `Redraw the shape of ${namesOf(a.ids)}`;
      // a shadow or a gradient is said by its name, not spelled out
      return `Change ${namesOf(a.ids)}: ${Object.entries(p).map(([k, v]) => (v && typeof v === "object" ? k : `${k} ${String(v)}`)).join(", ")}`;
    }
    case "duplicate_elements":
      return `Copy ${namesOf(a.ids)}`;
    case "move_elements":
      return `Move ${namesOf(a.ids)} by ${String(a.dx)}, ${String(a.dy)}`;
    case "resize_element":
      return `Resize ${nameOf(a.id)} to ${String(a.width)} by ${String(a.height)}`;
    case "reparent_elements":
      return `Move ${namesOf(a.ids)} ${a.parentId ? `into ${nameOf(a.parentId)}` : "out to the page"}`;
    case "delete_elements":
      return `Delete ${namesOf(a.ids)}`;
    case "resolve_comment":
      return `Resolve the comment "${String(R.currentDoc().comments?.find((c) => c.id === a.id)?.text ?? "").slice(0, 40)}"`;
    case "add_comment":
      return `Comment: ${String(a.text).slice(0, 40)}`;
    case "set_grade": {
      if (!a.grade) return `Reset the colour of ${namesOf(a.ids)}`;
      const g = a.grade as Record<string, unknown>;
      return `Change the colour of ${namesOf(a.ids)}: ${Object.entries(g).map(([k, v]) => (k === "look" ? (v ? "a look" : "no look") : `${k} ${String(v)}`)).join(", ")}`;
    }
    case "copy_grade":
      return `Give ${namesOf(a.ids)} the colour of ${nameOf(a.fromId)}`;
    case "load_look":
      return `Use the look ${String(a.path).split(/[\\/]/).pop()} on ${namesOf(a.ids)}`;
    default:
      return tool;
  }
}

/** Check the arguments and fill in anything that can be worked out. Returns an error message if it cannot be done. */
/** An AI often sends a layout with only some of the fields. Fill the rest in, so no number is left empty. */
export function fixLayouts(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fixLayouts);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === "layout" && val && typeof val === "object" && !Array.isArray(val)) {
      const l = val as Record<string, unknown>;
      const d = defaultLayout();
      const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
      out[k] = {
        dir: l.dir === "row" ? "row" : "column",
        gap: num(l.gap, d.gap),
        padX: num(l.padX, 0),
        padY: num(l.padY, 0),
        align: ["start", "center", "end", "stretch"].includes(String(l.align)) ? l.align : d.align,
        justify: ["start", "center", "end", "between"].includes(String(l.justify)) ? l.justify : d.justify,
        hug: l.hug === true,
      };
    } else out[k] = fixLayouts(val);
  }
  return out;
}

function prepare(tool: string, raw: Args, doc = R.currentDoc()): { args: Args } | { error: string } {
  const a = fixLayouts(raw) as Args;
  switch (tool) {
    case "resolve_comment": {
      const c = doc.comments?.find((x) => x.id === a.id);
      if (!c) return { error: `No comment with id ${String(a.id)}.` };
      if (c.resolved) return { error: "That comment is already resolved." };
      return { args: { id: a.id, reply: typeof a.reply === "string" ? a.reply : undefined } };
    }
    case "add_comment": {
      if (typeof a.x !== "number" || typeof a.y !== "number" || typeof a.text !== "string" || !a.text.trim()) return { error: "Give x and y as numbers, and the text." };
      return { args: { x: a.x, y: a.y, text: a.text, by: "ai" } };
    }
    case "create_element": {
      if (!["frame", "rect", "ellipse", "text", "path"].includes(String(a.type))) return { error: "type must be frame, rect, ellipse, text or path." };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      const p: Record<string, unknown> = { ...((a.props as Record<string, unknown>) ?? {}) };
      if (a.type === "text") {
        const text = typeof p.text === "string" ? p.text : "Text";
        const size = typeof p.fontSize === "number" ? p.fontSize : 16;
        const m = measureText(text, size);
        p.text = text;
        p.fontSize = size;
        a.width = typeof a.width === "number" ? a.width : m.width + 2;
        a.height = typeof a.height === "number" ? a.height : m.height;
      } else if (a.type === "path") {
        try {
          // the outline is measured from x, y; the path's own box is fitted around it
          const shape = outlineFromData(a.d as string);
          a.x = a.x + shape.x;
          a.y = a.y + shape.y;
          a.width = typeof a.width === "number" ? a.width : shape.width;
          a.height = typeof a.height === "number" ? a.height : shape.height;
          p.nodes = shape.nodes;
          p.closed = shape.closed;
          // a filled shape has no line around it unless one is asked for
          if (shape.closed && !("stroke" in p)) p.stroke = null;
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      } else {
        const fallback = a.type === "frame" ? { w: 360, h: 640 } : { w: 120, h: 120 };
        a.width = typeof a.width === "number" ? a.width : fallback.w;
        a.height = typeof a.height === "number" ? a.height : fallback.h;
      }
      if ("rotation" in p && (typeof p.rotation !== "number" || a.type === "frame")) return { error: a.type === "frame" ? "A frame cannot be turned." : "rotation must be a number of degrees." };
      delete a.d;
      a.props = p;
      a.id = newId(String(a.type));
      // the AI means the order it lists things in, so words made side by side do not swap places
      a.keepOrder = true;
      return { args: a };
    }
    case "create_elements": {
      // a suggestion that was already checked comes back through here when the designer taps Apply
      if (Array.isArray(a.items)) return { args: a };
      const made: Args[] = [];
      let work = doc;
      const walk = (list: unknown, parentId: unknown, depth: number): string | null => {
        if (!Array.isArray(list)) return "elements must be a list.";
        if (depth > 12) return "Elements are nested too deeply.";
        for (const raw of list) {
          if (!raw || typeof raw !== "object") return "Each element must be an object.";
          const { children, ...rest } = raw as Args;
          const lifted = liftProps(rest);
          if ("error" in lifted) return `Element ${made.length + 1}: ${lifted.error}`;
          const own = lifted.el;
          // inside a frame, nesting says where a thing goes: a parentId an agent made up there is ignored
          const one = prepare("create_element", { ...own, parentId: (depth === 0 ? own.parentId : null) ?? parentId ?? null }, work);
          if ("error" in one) return `Element ${made.length + 1} (${String(own.type)}): ${one.error}`;
          made.push(one.args);
          work = runCommand(work, "create_element", one.args as never);
          if (children != null) {
            if (own.type !== "frame") return `Element ${made.length} (${String(own.type)}): only a frame can have children.`;
            const bad = walk(children, one.args.id, depth + 1);
            if (bad) return bad;
          }
        }
        return null;
      };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      const bad = walk(a.elements, a.parentId, 0);
      if (bad) return { error: bad + BATCH_USAGE };
      if (!made.length) return { error: "elements is empty." + BATCH_USAGE };
      return { args: { items: made } };
    }
    case "place_image": {
      const path = typeof a.path === "string" ? a.path.trim() : "";
      if (!path) return { error: "path must be the full path to a picture file." };
      if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path)) return { error: "Give the full path to the file, starting from the top folder or from ~ for the home folder." };
      if (!mimeFor(path)) return { error: "That is not a picture Duet can use. It takes PNG, JPG, GIF, WebP and SVG files." };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      for (const k of ["width", "height"]) if (a[k] != null && !(typeof a[k] === "number" && (a[k] as number) > 0)) return { error: `${k} must be a number above 0.` };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.path = path;
      a.parentId = a.parentId ?? null;
      a.id = newId("image");
      return { args: a };
    }
    case "export_video": {
      const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
      if (!el) return { error: `No element with id: ${String(a.id)}. Use get_document to see the ids.` };
      if (!el.duration) return { error: `${el.name} has no length, so there is no video to make. Give it one with set_duration first.` };
      const ext = a.master === true ? "mov" : "mp4";
      if (a.path !== undefined && (typeof a.path !== "string" || !new RegExp(`\\.${ext}$`, "i").test(a.path.trim()))) return { error: `path must be a full file path that ends in .${ext}.` };
      if (a.fps !== undefined && ![24, 25, 30, 60].includes(Number(a.fps))) return { error: "fps must be 24, 25, 30 or 60." };
      if (a.size !== undefined && !(Number(a.size) >= 16 && Number(a.size) <= 8192)) return { error: "size must be a number of pixels between 16 and 8192." };
      if (a.quality !== undefined && !["best", "good", "small"].includes(String(a.quality))) return { error: "quality must be best, good or small." };
      return { args: a };
    }
    case "picture_of_duet": {
      if (typeof a.path !== "string" || !a.path.toLowerCase().endsWith(".png")) return { error: "path must be the full path of a new .png file." };
      if (a.space !== undefined && !["design", "video", "photo", "chat"].includes(String(a.space))) return { error: "space must be design, video, photo or chat." };
      if (a.panel !== undefined && !["properties", "colour"].includes(String(a.panel))) return { error: "panel must be properties or colour." };
      if (a.select !== undefined && (!Array.isArray(a.select) || a.select.some((id) => !doc.elements[String(id)]))) return { error: "select must be a list of ids from get_document." };
      return { args: a };
    }
    case "export_frame": {
      const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
      if (!el) return { error: `No element with id: ${String(a.id)}. Use get_document to see the ids.` };
      const ask = checkExport(a.path, a.scale, el.width, el.height);
      if ("error" in ask) return ask;
      a.path = ask.path;
      a.scale = ask.scale;
      return { args: a };
    }
    case "create_instance": {
      const main = typeof a.componentId === "string" ? doc.elements[a.componentId] : undefined;
      if (!main || !main.component) return { error: `${String(a.componentId)} is not a component. get_context lists the components.` };
      if (typeof a.x !== "number" || typeof a.y !== "number") return { error: "x and y must be numbers." };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.parentId = a.parentId ?? null;
      a.id = newId("instance");
      return { args: a };
    }
    case "set_props": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}. Use get_document to see the ids.` };
      if (!a.props || typeof a.props !== "object") return { error: "props must be an object." };
      const p: Record<string, unknown> = { ...(a.props as Record<string, unknown>) };
      for (const forbidden of ["id", "type", "parentId", "childIds", "componentId", "overrides"]) delete p[forbidden];
      const list = a.ids as string[];
      if ("component" in p) {
        if (p.component !== true) return { error: "component can only be set to true. To stop something being a component, ask the designer." };
        const not = list.filter((i) => doc.elements[i].type === "instance" || i.includes("::"));
        if (not.length) return { error: `${namesOf(not)} is a copy of a component, so it cannot be made into one.` };
      }
      if ("rotation" in p) {
        if (typeof p.rotation !== "number") return { error: "rotation must be a number of degrees." };
        const fixed = list.filter((i) => !canTurn(doc, i));
        if (fixed.length) return { error: `${namesOf(fixed)} cannot be turned. Frames and copies of components stay upright. Turn the things inside instead.` };
      }
      if ("d" in p) {
        if (list.length !== 1 || doc.elements[list[0]].type !== "path") return { error: "d redraws one path at a time. Give the id of one path." };
        try {
          const { closed, ...shape } = outlineFromData(p.d as string);
          delete p.d;
          Object.assign(p, shape, { closed });
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }
      // text that changes size should resize to fit, unless the agent said otherwise
      if (list.length === 1 && doc.elements[list[0]].type === "text" && ("text" in p || "fontSize" in p) && !("width" in p)) {
        const el = doc.elements[list[0]];
        const m = measureText(String(p.text ?? el.text), Number(p.fontSize ?? el.fontSize));
        p.width = m.width + 2;
        p.height = m.height;
      }
      a.props = p;
      return { args: a };
    }
    case "set_grade":
    case "copy_grade":
    case "load_look": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      const list = a.ids as string[];
      const plain = list.filter((i) => !canGrade(doc.elements[i]));
      if (plain.length) return { error: `${namesOf(plain)} is not a picture or a clip. Only pictures and clips have colour to change. A shape's colour is its fill, set with set_props.` };
      if (tool === "copy_grade") {
        const from = typeof a.fromId === "string" ? doc.elements[a.fromId] : undefined;
        if (!from || !canGrade(from)) return { error: `${String(a.fromId)} is not a picture or a clip to copy from.` };
        return { args: { ids: list, grade: from.grade ? { ...from.grade } : null, label: `Copy the colour of ${from.name}` } };
      }
      if (tool === "load_look") {
        const path = typeof a.path === "string" ? a.path.trim() : "";
        if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path) || !/\.cube$/i.test(path)) return { error: "Give the full path to a .cube file, starting from the top folder or from ~." };
        if (a.amount != null && !(typeof a.amount === "number" && a.amount >= 0 && a.amount <= 1)) return { error: "amount must be a number from 0 to 1." };
        return { args: { ids: list, path, amount: typeof a.amount === "number" ? a.amount : 1 } };
      }
      if (a.reset === true) return { args: { ids: list, grade: null } };
      if (!a.grade || typeof a.grade !== "object") return { error: "Give grade, the controls to change, or reset true." };
      const known = new Set<string>([...GRADE_CONTROLS.map((c) => c.key), "look"]);
      const g = a.grade as Record<string, unknown>;
      const unknown = Object.keys(g).filter((k) => !known.has(k));
      if (unknown.length) return { error: `I do not know ${unknown.join(", ")}. The controls are: ${GRADE_CONTROLS.map((c) => c.key).join(", ")}.` };
      for (const c of GRADE_CONTROLS) {
        if (!(c.key in g)) continue;
        const v = g[c.key];
        if (typeof v !== "number" || !Number.isFinite(v)) return { error: `${c.key} must be a number.` };
        if (v < c.min || v > c.max) return { error: `${c.key} goes from ${c.min} to ${c.max}.` };
      }
      if ("look" in g && g.look !== "") return { error: "To use a look, call load_look with the path to the .cube file. Send look as an empty text only to remove it." };
      return { args: { ids: list, grade: g } };
    }
    case "trace_image": {
      const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
      if (!el) return { error: `No element with id: ${String(a.id)}.` };
      if (el.type !== "image") return { error: `${el.name} is not a picture. Only pictures can be traced.` };
      return { args: { id: el.id } };
    }
    case "make_mask": {
      const shape = typeof a.shapeId === "string" ? doc.elements[a.shapeId] : undefined;
      if (!shape) return { error: `No element with id: ${String(a.shapeId)}.` };
      if (!canMask(shape)) return { error: `${shape.name} cannot be a mask. Use a rectangle, an ellipse or a closed path.` };
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      const list = (a.ids as string[]).filter((i) => i !== shape.id);
      if (list.length === 0) return { error: "Give at least one thing to show inside the shape." };
      const apart = list.filter((i) => (doc.elements[i].parentId ?? null) !== (shape.parentId ?? null));
      if (apart.length) return { error: `${namesOf(apart)} must be in the same frame as ${shape.name} first. Use reparent_elements.` };
      return { args: { maskId: shape.id, ids: list, groupId: newId("group") } };
    }
    case "set_duration": {
      const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
      if (!el) return { error: `No element with id: ${String(a.id)}.` };
      if (el.type !== "frame" || el.parentId) return { error: `${el.name} is not a frame on the page. Only a frame on the page can play.` };
      if (typeof a.seconds !== "number" || a.seconds < 0) return { error: "seconds must be a number, 0 or more." };
      return { args: a };
    }
    case "set_timing":
    case "set_entrance": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      const still = (a.ids as string[]).filter((i) => !sceneOf(doc, i) || sceneOf(doc, i)?.id === i);
      if (still.length) return { error: `${namesOf(still)} must be inside a frame that plays. Use set_duration on the frame first.` };
      if (tool === "set_timing") {
        for (const k of ["start", "end", "clipFrom"]) if (a[k] != null && !(typeof a[k] === "number" && (a[k] as number) >= 0)) return { error: `${k} must be a number, 0 or more.` };
        if (a.start == null && a.end == null && a.clipFrom == null) return { error: "Give start, end or clipFrom." };
      } else {
        if (a.when !== "in" && a.when !== "out") return { error: "when must be in or out." };
        if (!(ENTRANCES as readonly string[]).includes(String(a.kind))) return { error: `kind must be one of: ${ENTRANCES.join(", ")}.` };
      }
      return { args: a };
    }
    case "set_curve": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      const props = Array.isArray(a.props) ? a.props.map(String) : [];
      if (!props.length || props.some((p) => !(MOVING as readonly string[]).includes(p))) return { error: "props must be a list of x, y, width, height, opacity or rotation." };
      if (typeof a.t !== "number") return { error: "t must be a number of seconds." };
      const shape = a.shape;
      const ok = typeof shape === "string" ? ["steady", "gentle", "snappy", "bouncy"].includes(shape) : Array.isArray(shape) && shape.length === 4 && shape.every((n) => typeof n === "number");
      if (!ok) return { error: "shape must be steady, gentle, snappy, bouncy, or four numbers." };
      return { args: a };
    }
    case "animate": {
      if (missing([a.id]).length) return { error: `No element with id: ${String(a.id)}.` };
      const scene = sceneOf(doc, String(a.id));
      if (!scene || scene.id === a.id) return { error: `${nameOf(a.id)} must be inside a frame that plays. Use set_duration on the frame first.` };
      if (!(MOVING as readonly string[]).includes(String(a.prop))) return { error: `prop must be one of: ${MOVING.join(", ")}.` };
      if (!Array.isArray(a.keys)) return { error: "keys must be a list of moments, each with t and v." };
      for (const k of a.keys as Record<string, unknown>[]) {
        if (typeof k?.t !== "number" || typeof k?.v !== "number") return { error: "Each moment needs t and v as numbers." };
        if (k.ease != null && !["linear", "in", "out", "in-out"].includes(String(k.ease))) return { error: "ease must be linear, in, out or in-out." };
      }
      return { args: a };
    }
    case "place_sound": {
      const path = typeof a.path === "string" ? a.path.trim() : "";
      if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path)) return { error: "Give the full path to the file, starting from the top folder or from ~ for the home folder." };
      if (!/\.(mp3|wav|m4a|aac|aiff?|ogg|flac)$/i.test(path)) return { error: "That is not a sound Duet can use. It takes MP3, WAV, M4A, AAC, AIFF, OGG and FLAC files." };
      const scene = doc.elements[String(a.parentId)];
      if (!scene || scene.type !== "frame" || scene.parentId || !(scene.duration > 0)) return { error: "parentId must be a frame that plays. Use set_duration on a frame on the page first." };
      if (a.start != null && typeof a.start !== "number") return { error: "start must be a number." };
      if (a.volume != null && !(typeof a.volume === "number" && a.volume >= 0 && a.volume <= 1)) return { error: "volume must be a number from 0 to 1." };
      a.path = path;
      a.id = newId("sound");
      return { args: a };
    }
    case "place_video": {
      const path = typeof a.path === "string" ? a.path.trim() : "";
      if (!/^(~[\\/]|[\\/]|[a-zA-Z]:[\\/])/.test(path)) return { error: "Give the full path to the file, starting from the top folder or from ~ for the home folder." };
      if (!/\.(mp4|mov|m4v|webm)$/i.test(path)) return { error: "That is not a video Duet can use. It takes MP4, MOV, M4V and WebM files." };
      const scene = doc.elements[String(a.parentId)];
      if (!scene || scene.type !== "frame" || scene.parentId || !(scene.duration > 0)) return { error: "parentId must be a frame that plays. Use set_duration on a frame on the page first." };
      for (const k of ["start", "x", "y"]) if (a[k] != null && typeof a[k] !== "number") return { error: `${k} must be a number.` };
      for (const k of ["width", "height"]) if (a[k] != null && !(typeof a[k] === "number" && (a[k] as number) > 0)) return { error: `${k} must be a number above 0.` };
      a.path = path;
      a.id = newId("video");
      return { args: a };
    }
    case "duplicate_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      for (const k of ["dx", "dy"]) if (a[k] != null && typeof a[k] !== "number") return { error: `${k} must be a number.` };
      const parents = new Set((a.ids as string[]).map((i) => doc.elements[i].parentId ?? null));
      if (parents.size > 1 && a.parentId == null) return { error: "These things sit in different frames. Copy them one frame at a time, or give parentId." };
      return { args: a };
    }
    case "move_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      if (typeof a.dx !== "number" || typeof a.dy !== "number") return { error: "dx and dy must be numbers." };
      return { args: a };
    }
    case "resize_element": {
      if (missing([a.id]).length) return { error: `No element with id: ${String(a.id)}.` };
      for (const k of ["x", "y", "width", "height"]) if (typeof a[k] !== "number") return { error: `${k} must be a number.` };
      return { args: a };
    }
    case "reparent_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      if (a.parentId != null && doc.elements[String(a.parentId)]?.type !== "frame") return { error: `parentId ${String(a.parentId)} is not a frame.` };
      a.parentId = a.parentId ?? null;
      return { args: a };
    }
    case "delete_elements": {
      const bad = missing(a.ids);
      if (bad.length) return { error: `No element with id: ${bad.join(", ")}.` };
      return { args: a };
    }
    default:
      return { error: `Unknown tool ${tool}.` };
  }
}

// ---- each AI works in its own project, whichever one is on screen ----

/** The project each AI works in, by the name it goes by, and when it last did something there. */
const homes = new Map<string, { file: string | null; at: number; thread?: string; chosen?: boolean }>();
/** An AI quiet for this long is taken to have finished. When it comes back it works on the project on screen. */
const HOME_KEPT_MS = 10 * 60 * 1000;

/** The project an AI works in from now on, and the task it works for, if any. Duet's chat sets it when it starts its AI. */
export function bindAi(by: string, file: string | null, thread?: string) {
  homes.set(by, { file, at: Date.now(), ...(thread ? { thread } : {}) });
}

/** The projects an AI from outside is at work in right now, for the sign on their tabs. */
export function outsideHomes(): string[] {
  const now = Date.now();
  return [...homes.entries()].filter(([by, h]) => isOutside(by) && h.file && now - h.at < 60_000).map(([, h]) => h.file as string);
}

/** The project this AI works in. Null when it was closed while the AI was at work. */
function roomOf(by?: string, thread?: string): Room | null {
  // an AI at work on a task says so, and works in that task's project
  const task = taskOf(thread);
  if (task) {
    T = task.key;
    // the project on show may have no file yet, so it is found by its conversation, not its file
    return task.project === conversationProject() ? liveRoom : roomFor(task.project || null);
  }
  const busy = getChat().busy;
  // Duet's own chat: the AI works in the project of the conversation it was started from
  if (by && !isOutside(by) && busy !== null) return busy === conversationProject() ? liveRoom : roomFor(busy || null);
  if (!by) return liveRoom;
  const now = Date.now();
  const home = homes.get(by);
  // a project the AI chose itself is kept until it chooses another, however long it is quiet
  if (home?.chosen) {
    home.at = now;
    return roomFor(home.file);
  }
  if (!home || now - home.at > HOME_KEPT_MS) {
    homes.set(by, { file: liveRoom.file, at: now });
    return liveRoom;
  }
  home.at = now;
  if (home.thread && taskOf(home.thread)) T = home.thread;
  const room = roomFor(home.file);
  if (room) return room;
  // The project it started in is gone: closed, or saved for the first time under a new name.
  // It never chose one itself, so it follows the project on screen instead of stopping.
  homes.set(by, { file: liveRoom.file, at: now });
  return liveRoom;
}

/** The open projects, the one on screen first, by the name on their tab. */
function openProjects(): { file: string; name: string }[] {
  const on = liveRoom.file;
  const files = [...(on ? [on] : []), ...parkedFiles().filter((f) => f !== on)];
  return files.map((file) => ({ file, name: tabName(file) }));
}

/** An AI from outside chooses the project it works in, and keeps it whichever tab is on screen. */
function workInProject(raw: unknown, by?: string): ToolResult {
  const open = openProjects();
  const list = open.map((p) => `- ${p.name}${p.file === liveRoom.file ? " (on screen)" : ""}`).join("\n");
  const name = raw && typeof raw === "object" ? (raw as Args).name : undefined;
  if (typeof name !== "string" || !name.trim()) return { text: open.length ? `The open projects:\n${list}` : "No project with a file is open." };
  if (!by || !isOutside(by)) return fail("Only an AI connected from outside Duet's chat chooses its project. Duet's chat works in the project it was started from.");
  const want = name.trim().toLowerCase().replace(/\.duet$/, "");
  const found = open.find((p) => p.name.toLowerCase() === want) ?? open.find((p) => p.name.toLowerCase().includes(want));
  if (!found) return fail(`No open project is called "${name}". Ask the designer to open it. The open projects:\n${list}`);
  homes.set(by, { file: found.file, at: Date.now(), chosen: true });
  return { text: `You now work in "${found.name}", whichever tab the designer looks at, until you choose another project or it is closed.` };
}

/** The project the call being answered works in. Calls are answered one at a time, so this is never mixed up. */
let R: Room = liveRoom;
/** The task the call being answered works for. Null for the main chat. */
let T: string | null = null;
let calls: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const next = calls.then(job, job);
  calls = next.catch(() => undefined);
  return next;
}
/** The conversation that hears about this call: the one of its project. */
const said = () => T ?? (R.live ? undefined : R.file);

/** The step before the AI acts is already saved, so any AI change can be undone and the earlier state is safe. */
async function ensureSaved() {
  // a project waiting in its tab saves each change by itself
  if (!R.live) return;
  const p = R.getState().project;
  if (p.path && p.status !== "saved") await saveNow();
}

/**
 * Save after an AI change, but only a project that already has a file. Work with no file yet stays
 * unsaved: an AI's change must never put a Save window in front of the designer.
 */
function saveIfHome() {
  if (R.live && R.getState().project.path) void saveNow();
}

/** Longest side of a picture the AI brings in, unless it asks for a size. Same as a picture the designer drops in. */
const PICTURE_SIDE = 640;

/** Read a picture file from the computer, keep it in the project, and put it on the canvas. */
async function placeImage(args: Args, by?: string): Promise<ToolResult> {
  const file = String(args.path).split(/[\\/]/).pop() ?? "Image";
  let pic: { src: string; width: number; height: number };
  try {
    let path = String(args.path);
    if (path.startsWith("~")) {
      // Duet's own folder sits in the home folder, which is how the home folder is found
      const home = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[\\/]?$/, "");
      path = home + path.slice(1);
    }
    const bin = atob(await invoke<string>("read_binary_file", { path }));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    pic = await addPicture(file, bytes);
  } catch {
    return fail(`The picture at ${String(args.path)} could not be read. Check the path, and that the file is a picture.`);
  }
  const shape = pic.width / pic.height;
  let width: number;
  let height: number;
  if (typeof args.width === "number" && typeof args.height === "number") [width, height] = [args.width, args.height];
  else if (typeof args.width === "number") [width, height] = [args.width, args.width / shape];
  else if (typeof args.height === "number") [width, height] = [args.height * shape, args.height];
  else {
    const k = Math.min(1, PICTURE_SIDE / Math.max(pic.width, pic.height));
    [width, height] = [pic.width * k, pic.height * k];
  }
  width = Math.max(8, Math.round(width));
  height = Math.max(8, Math.round(height));
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : file.replace(/\.[^.]+$/, "") || "Image";
  await ensureSaved();
  R.dispatch("create_element", { type: "image", id: String(args.id), parentId: args.parentId as string | null, x: Number(args.x), y: Number(args.y), width, height, props: { src: pic.src, name } }, "ai", by);
  if (!R.currentDoc().elements[String(args.id)]) return fail("The picture could not be placed there.");
  addMsg({ role: "note", text: `Brought in the picture ${file}`, ...stepNow() }, said());
  saveIfHome();
  return { text: `Placed the picture as ${String(args.id)} named "${name}", ${width} by ${height} (the file is ${pic.width} by ${pic.height}). Call look_at_image to see it.` };
}

/** Put a video file from the computer into a frame that plays. The file stays where it is. */
async function loadLook(args: Args, by?: string): Promise<ToolResult> {
  let path = String(args.path);
  if (path.startsWith("~")) path = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + path.slice(1);
  let kept: string;
  try {
    kept = await invoke<string>("look_keep", { path });
  } catch (e) {
    return fail(`The look at ${String(args.path)} could not be used. ${String(e)}`);
  }
  await ensureSaved();
  const file = kept.split(/[\\/]/).pop();
  R.dispatch("set_grade", { ids: args.ids as string[], grade: { look: kept, lookAmount: Number(args.amount) }, label: `Use the look ${file}` }, "ai", by);
  addMsg({ role: "note", text: summarise("load_look", args), ...stepNow() }, said());
  saveIfHome();
  return { text: `Using the look ${file} at ${Math.round(Number(args.amount) * 100)}% on ${namesOf(args.ids)}. It is kept at ${kept}. Check it with color_readings and look_at_design.` };
}

async function colorReadings(a: Args): Promise<ToolResult> {
  const doc = R.currentDoc();
  const el = typeof a.id === "string" ? doc.elements[a.id] : undefined;
  if (!el) return fail(`No element with id: ${String(a.id)}.`);
  if (!canGrade(el)) return fail(`${el.name} is not a picture or a clip.`);
  let pic: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | null;
  if (el.type === "image") {
    await preloadPictures(doc);
    pic = pictureOf(el);
  } else {
    const scene = sceneOf(doc, el.id);
    if (scene && typeof a.t === "number") await seekClips(doc, scene.id, a.t);
    pic = typeof a.t === "number" ? clipPicture(el.src, el.id) : clipPictureOf(el);
    if (pic && !pic.videoWidth) pic = null;
  }
  const read = pic && gradeReadings(pic, a.original === true ? null : el.grade);
  letGoOfOriginals();
  if (!pic) return fail(`${el.name} has not loaded yet. Try again in a moment.`);
  if (!read) return fail("The colour could not be read on this computer.");
  return { text: JSON.stringify({ id: el.id, name: el.name, grade: gradeChanges(el.grade), readings: read, of: a.original === true ? "the original, without its colour changes" : "with its colour changes" }, null, 2) };
}

async function placeVideo(args: Args, by?: string): Promise<ToolResult> {
  let path = String(args.path);
  // Duet's own folder sits in the home folder, which is how the home folder is found
  if (path.startsWith("~")) path = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + path.slice(1);
  let info: { duration: number; width: number; height: number; sound: boolean };
  try {
    info = await invoke("video_info", { path });
  } catch (e) {
    return fail(`The clip at ${String(args.path)} could not be read. ${String(e)}`);
  }
  const sceneId = String(args.parentId);
  const scene = R.currentDoc().elements[sceneId];
  const start = Math.max(0, Number(args.start) || 0);
  const end = Math.round((start + info.duration) * 1000) / 1000;
  const k = Math.min(scene.width / info.width, scene.height / info.height);
  const shape = info.width / info.height;
  let width = typeof args.width === "number" ? args.width : typeof args.height === "number" ? args.height * shape : info.width * k;
  let height = typeof args.height === "number" ? args.height : width / shape;
  width = Math.max(8, Math.round(width));
  height = Math.max(8, Math.round(height));
  const x = typeof args.x === "number" ? args.x : Math.round((scene.width - width) / 2);
  const y = typeof args.y === "number" ? args.y : Math.round((scene.height - height) / 2);
  const file = path.split(/[\\/]/).pop() ?? "Clip";
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : file;
  await ensureSaved();
  if (end > scene.duration) R.dispatch("set_duration", { id: sceneId, seconds: end }, "ai", by);
  R.dispatch("create_element", { type: "video", id: String(args.id), parentId: sceneId, x, y, width, height, props: { src: path, name, start, end } }, "ai", by);
  if (!R.currentDoc().elements[String(args.id)]) return fail("The clip could not be placed there.");
  addMsg({ role: "note", text: `Brought in the clip ${file}`, ...stepNow() }, said());
  saveIfHome();
  return { text: `Placed the clip as ${String(args.id)} named "${name}", ${width} by ${height}, showing from ${start}s to ${end}s (the file is ${info.duration}s long, ${info.width} by ${info.height}, ${info.sound ? "with" : "without"} sound). The frame now plays for ${R.currentDoc().elements[sceneId].duration}s.` };
}

/** Save a frame as a PNG file. A file that is already there is never replaced, and the design is not changed. */
async function exportFrame(args: Args): Promise<ToolResult> {
  let path = String(args.path);
  if (path.startsWith("~")) path = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + path.slice(1);
  if ((await invoke<boolean>("path_exists", { path })) === true) return fail(`${String(args.path)} already exists. Choose a new file name; nothing was saved.`);
  const doc = R.currentDoc();
  const el = doc.elements[String(args.id)];
  await preloadPictures(doc);
  const scale = Number(args.scale) || 1;
  try {
    await invoke("write_binary_file", { path, dataBase64: renderPng(doc, el.id, scale) });
  } catch (e) {
    return fail(`Could not save the picture. ${String(e)}`);
  }
  const w = Math.max(1, Math.round(el.width * scale));
  const h = Math.max(1, Math.round(el.height * scale));
  return { text: `Saved "${el.name}" as ${path}, ${w} by ${h} pixels (before any turn). The design was not changed.` };
}

/** A picture of the Duet window, drawn by Duet itself, after showing the space, panel and selection asked for. */
async function pictureOfDuet(args: Args): Promise<ToolResult> {
  let path = String(args.path);
  if (path.startsWith("~")) path = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + path.slice(1);
  if ((await invoke<boolean>("path_exists", { path })) === true) return fail(`${String(args.path)} already exists. Choose a new file name; nothing was saved.`);
  const space = args.space as string | undefined;
  if (space === "chat") setLayout({ space: "chat" });
  else if (space) setLayout({ space: "edit", mode: space === "video" ? "motion" : (space as "design" | "photo") });
  if (args.panel) {
    const tab = args.panel === "colour" ? "color" : "properties";
    setLayout(space === "video" ? { videoTab: tab } : { photoTab: tab });
  }
  if (Array.isArray(args.select)) {
    R.select(args.select.map(String));
    window.dispatchEvent(new Event("duet:show-selection"));
  }
  // let the panels settle and the canvas draw before the picture is taken
  await preloadPictures(R.currentDoc());
  await new Promise((done) => setTimeout(done, 600));
  // the dev copy's own marks stay out of the picture
  document.body.classList.add("picturing");
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  try {
    await invoke("window_picture", { path });
  } catch (e) {
    return fail(`Could not take the picture. ${String(e)}`);
  } finally {
    document.body.classList.remove("picturing");
  }
  return { text: `Saved a picture of the Duet window as ${path}. Look at it before using it. The design was not changed.` };
}

/** Make a video of a frame that plays, the same way the designer's Export video does. */
async function exportVideo(args: Args): Promise<ToolResult> {
  let to: string | undefined;
  if (typeof args.path === "string") {
    to = args.path.trim();
    if (to.startsWith("~")) to = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + to.slice(1);
    if ((await invoke<boolean>("path_exists", { path: to })) === true) return fail(`${String(args.path)} already exists. Choose a new file name; nothing was saved.`);
    const dir = to.replace(/[\\/][^\\/]*$/, "");
    if (dir) await invoke("make_dir", { path: dir }).catch(() => undefined);
  }
  const quality = QUALITIES[{ best: 0, good: 1, small: 2 }[String(args.quality ?? "good") as "best" | "good" | "small"]].quality;
  const began = Date.now();
  try {
    // the video is drawn off screen, so a project waiting in its tab is made into one without coming on screen
    const doc = R.currentDoc();
    await preloadPictures(doc);
    const file = await exportScene(String(args.id), () => {}, { ...defaultChoice(), fps: Number(args.fps) || 30, longSide: Number(args.size) || 0, quality, master: args.master === true, ...(to ? { to } : {}) }, doc);
    if (!file) return fail("The video was not made.");
    return { text: `Made the video ${file} in ${Math.round((Date.now() - began) / 1000)} seconds. The design was not changed.` };
  } catch (e) {
    return fail(`The video could not be made. ${String(e instanceof Error ? e.message : e)}`);
  }
}

/** Put a sound file from the computer into a frame that plays. The file stays where it is. */
async function placeSound(args: Args, by?: string): Promise<ToolResult> {
  let path = String(args.path);
  // Duet's own folder sits in the home folder, which is how the home folder is found
  if (path.startsWith("~")) path = (await invoke<string>("duet_home")).replace(/[\\/]\.duet[^\\/]*[\\/]?$/, "") + path.slice(1);
  let length: number;
  try {
    length = await fileLength(path);
  } catch {
    return fail(`The sound at ${String(args.path)} could not be played. Check the path, and that it is a sound file in a folder Duet can reach (not a hidden folder).`);
  }
  const sceneId = String(args.parentId);
  const scene = R.currentDoc().elements[sceneId];
  const start = Math.max(0, Math.min(scene.duration - 0.1, Number(args.start) || 0));
  const end = Math.min(scene.duration, Math.round((start + length) * 1000) / 1000);
  const file = path.split(/[\\/]/).pop() ?? "Sound";
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : file;
  await ensureSaved();
  R.dispatch("create_element", { type: "sound", id: String(args.id), parentId: sceneId, x: 0, y: 0, width: 1, height: 1, props: { src: path, name, start, end, volume: typeof args.volume === "number" ? args.volume : 1 } }, "ai", by);
  if (!R.currentDoc().elements[String(args.id)]) return fail("The sound could not be placed there.");
  addMsg({ role: "note", text: `Brought in the sound ${file}`, ...stepNow() }, said());
  saveIfHome();
  return { text: `Placed the sound as ${String(args.id)} named "${name}", heard from ${start}s to ${end}s (the file is ${Math.round(length * 10) / 10}s long, the frame plays for ${scene.duration}s).` };
}

/** The step a change has just made: where it is for Undo, and its name so the words stay tied to it. */
function stepNow() {
  const s = R.getState();
  return { undoStep: s.cursor, step: s.timeline[s.cursor].step };
}

/** Trace a picture into shapes, as one step the designer can undo. */
async function traceImage(args: Args, by?: string): Promise<ToolResult> {
  await ensureSaved();
  const name = nameOf(args.id);
  const result = await tracePicture(String(args.id), "ai", by, R);
  if ("why" in result) return fail(result.why);
  addMsg({ role: "note", text: `Traced ${name} into shapes`, ...stepNow() }, said());
  saveIfHome();
  const where = result.groupId ? `, together in the group ${result.groupId}` : "";
  return { text: `Made ${result.ids.length} ${result.ids.length === 1 ? "path" : "paths"}: ${result.ids.join(", ")}${where}. They sit exactly over the picture, which is still there. Change their fill with set_props.` };
}

async function duplicateElements(args: Args, by?: string): Promise<ToolResult> {
  await ensureSaved();
  const doc = R.currentDoc();
  const payload = extractPayload(doc, args.ids as string[]);
  if (!payload) return fail("Nothing to copy.");
  const first = doc.elements[payload.rootIds[0]];
  const parentId = args.parentId != null ? String(args.parentId) : first.parentId ?? null;
  const idMap: Record<string, string> = {};
  for (const [oldId, el] of Object.entries(payload.elements)) idMap[oldId] = newId(el.type);
  // a screen goes beside its original, anything else is nudged so it does not hide the original
  const sameParent = payload.rootIds.every((id) => (doc.elements[id].parentId ?? null) === parentId);
  const beside = !first.parentId && first.type === "frame" && sameParent;
  const dx = typeof args.dx === "number" ? args.dx : beside ? first.width + 40 : sameParent ? 16 : 0;
  const dy = typeof args.dy === "number" ? args.dy : beside ? 0 : sameParent ? 16 : 0;
  R.dispatch("paste_elements", { payload, parentId, dx, dy, idMap, label: "Duplicate" }, "ai", by);
  addMsg({ role: "note", text: summarise("duplicate_elements", args), ...stepNow() }, said());
  saveIfHome();
  const made = payload.rootIds.map((id) => `${id} -> ${idMap[id]}`).join(", ");
  return { text: `Copied ${payload.rootIds.length === 1 ? "it" : `${payload.rootIds.length} things`} with everything inside. New ids: ${made}. The copy is a separate design now: change it with set_props and the original stays as it was.` };
}

async function apply(tool: string, args: Args, by?: string): Promise<ToolResult> {
  if (tool === "export_frame") return exportFrame(args);
  if (tool === "export_video") return exportVideo(args);
  if (tool === "place_image") return placeImage(args, by);
  if (tool === "place_video") return placeVideo(args, by);
  if (tool === "place_sound") return placeSound(args, by);
  if (tool === "trace_image") return traceImage(args, by);
  if (tool === "duplicate_elements") return duplicateElements(args, by);
  if (tool === "load_look") return loadLook(args, by);
  await ensureSaved();
  // changing a value over time is one tool for the AI and the set_keys command underneath, and copying a colour is setting it
  const command = (tool === "animate" ? "set_keys" : tool === "copy_grade" ? "set_grade" : tool) as CommandName;
  const label = commandLabel(command, args as never);
  R.dispatch(command, args as never, "ai", by);
  addMsg({ role: "note", text: summarise(tool, args), ...stepNow() }, said());
  saveIfHome();
  if (tool === "set_grade" || tool === "copy_grade") {
    const doc = R.currentDoc();
    return { text: `Done: ${label}. The colour now: ${JSON.stringify(Object.fromEntries((args.ids as string[]).map((i) => [i, gradeChanges(doc.elements[i]?.grade)])))}. Check it with color_readings and look_at_design.` };
  }
  if (tool === "create_instance") return { text: `Placed a copy with id ${String(args.id)}. Its parts have ids that start with "${String(args.id)}::". Change them with set_props to change this copy only.` };
  if (tool === "make_mask") {
    if (!R.currentDoc().elements[String(args.groupId)]) return fail("That mask could not be made.");
    return { text: `Made the mask group ${String(args.groupId)}. It is as big as the shape. Its things kept their ids.` };
  }
  if (tool === "create_elements") {
    const items = (args.items as { id: string; type: string }[]) ?? [];
    const doc = R.currentDoc();
    return { text: `Created ${items.length} elements: ${items.map((i) => `${i.id} "${doc.elements[i.id]?.name}"`).join(", ")}. Look at the design to check it.` };
  }
  if (tool === "create_element") {
    const el = R.currentDoc().elements[String(args.id)];
    const box = el?.type === "path" ? ` Its box sits at ${Math.round(el.x)},${Math.round(el.y)} and is ${Math.round(el.width)} by ${Math.round(el.height)}.` : "";
    return { text: `Created ${String(args.id)} named "${el?.name}" (${label}).${box}` };
  }
  return { text: `Done: ${label}.` };
}

/** Called when the designer taps Apply on a suggestion. */
export async function applyProposal(msgId: number) {
  const where = getChat().thread ?? undefined;
  const msg = messagesOf(where).find((m) => m.id === msgId);
  if (!msg?.proposal || msg.proposal.status !== "open") return;
  const check = prepare(msg.proposal.tool, msg.proposal.args as Args);
  if ("error" in check) {
    updateMsg(msgId, { proposal: { ...msg.proposal, status: "dismissed" } }, where);
    addMsg({ role: "error", text: `That suggestion no longer fits the design. ${check.error}` }, where);
    return;
  }
  updateMsg(msgId, { proposal: { ...msg.proposal, status: "applied" } }, where);
  const proposal = msg.proposal;
  await oneAtATime(() => {
    R = liveRoom;
    T = where ?? null;
    return apply(proposal.tool, check.args, proposal.by);
  });
}

/** Take back an AI change, if nothing happened after it. */
export function undoAiStep(msgId: number) {
  const where = getChat().thread ?? undefined;
  const msg = messagesOf(where).find((m) => m.id === msgId);
  if (msg?.undoStep === undefined) return;
  const s = getState();
  if (s.cursor !== msg.undoStep) return;
  goTo(parentOf(s.timeline, msg.undoStep));
  updateMsg(msgId, { undone: true }, where);
}

/** The comments not yet dealt with, each with the thing under it, the frame it is in, and the things around it. */
function openComments(doc: Doc) {
  return (doc.comments ?? [])
    .filter((c) => !c.resolved)
    .map((c) => {
      const near = Object.keys(doc.elements)
        .filter((id) => !doc.elements[id].hidden)
        .map((id) => ({ id, r: worldBounds(doc, id) }))
        .filter(({ r }) => c.x >= r.x - 60 && c.x <= r.x + r.width + 60 && c.y >= r.y - 60 && c.y <= r.y + r.height + 60)
        // smallest first: the closest things around the spot, not the frame they sit in
        .sort((p, q) => p.r.width * p.r.height - q.r.width * q.r.height)
        .slice(0, 6)
        .map(({ id }) => ({ id, name: doc.elements[id].name, type: doc.elements[id].type }));
      const under = c.on && doc.elements[c.on] ? c.on : near[0]?.id;
      const frame = under ? frameOf(doc, under) : null;
      return { id: c.id, text: c.text, by: c.by, x: c.x, y: c.y, on: under ? { id: under, name: doc.elements[under].name } : null, frame: frame ? doc.elements[frame].name : null, near };
    });
}

function context(): string {
  const s = R.getState();
  const doc = R.currentDoc();
  const frames = doc.rootIds
    .map((id) => doc.elements[id])
    .filter((e) => e && e.type === "frame")
    .map((e) => ({ id: e.id, name: e.name, width: e.width, height: e.height }));
  return JSON.stringify(
    {
      project: s.project.name,
      saved: !!s.project.path,
      permission: getChat().mode,
      selection: s.selection.filter((i) => doc.elements[i]).map((i) => ({ id: i, name: doc.elements[i].name, type: doc.elements[i].type })),
      // where the designer has pointed you. Work there. You may look elsewhere, nothing outside it is blocked.
      focus: s.focus.filter((i) => doc.elements[i]).map((i) => ({ id: i, name: doc.elements[i].name, type: doc.elements[i].type })),
      frames,
      components: componentsIn(doc).map((c) => ({ id: c.id, name: c.name, width: c.width, height: c.height })),
      elementCount: Object.keys(doc.elements).length,
      units: "pixels. x and y are relative to the parent frame, or to the page for top-level things.",
      skillsLoaded: getSkills().filter((k) => k.enabled).map((k) => k.name),
      // pictures given with chat messages; "waiting" ones sit in the message box and have not been sent yet
      // notes the designer pinned on the canvas: do what each asks, at that spot, then resolve_comment
      comments: openComments(doc),
      attachedPictures: getChat().pictures.map((p) => ({ number: p.n, name: p.name, kind: p.text === undefined ? "picture" : "text", waiting: !p.sent })),
    },
    null,
    2,
  );
}

// the working area stays up for as long as the chat's own AI is busy, however long it thinks
keepAiWorkWhile(() => getChat().running || getChat().tasks.some((t) => t.running));

/** An AI has started, or is still going: keep its working area up if it has one. The area is never claimed just by starting. */
export function aiStarted(by?: string) {
  startedIn(liveRoom, by);
}
function startedIn(room: Room, by?: string) {
  if (!room.live) return;
  const was = R;
  R = room;
  R.touchAiWork(by);
  R = was;
}

/** Ids whose element was added, changed or removed between two versions of the design. */
function changedIds(a: Doc, b: Doc): string[] {
  const out: string[] = [];
  for (const id in b.elements) if (a.elements[id] !== b.elements[id]) out.push(id);
  for (const id in a.elements) if (!b.elements[id]) out.push(id);
  return out;
}

/** Run one tool call from an agent. `by` is the name of the AI tool that asked, when it said who it is. */
export function callTool(name: string, raw: unknown, by?: string, thread?: string): Promise<ToolResult> {
  return oneAtATime(async () => {
    T = null;
    if (name === "work_in_project") return workInProject(raw, by);
    const room = roomOf(by, thread);
    if (!room) return fail("The project you were working in has been closed, so nothing was changed. Stop, and tell the designer what you were doing.");
    R = room;
    return answerTool(name, raw, by);
  });
}

async function answerTool(name: string, raw: unknown, by?: string): Promise<ToolResult> {
  const a = (raw && typeof raw === "object" ? raw : {}) as Args;
  const mode = getChat().mode;

  startedIn(R, by);
  if (name === "mark_working_area") {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const area = { x: n(a.x), y: n(a.y), width: n(a.width), height: n(a.height) };
    if (Object.values(area).some(Number.isNaN) || area.width <= 0 || area.height <= 0) return fail("x, y, width and height must be numbers, with width and height above 0.");
    R.noteAiArea(area, by);
    return { text: "The designer now sees where you are working. Build there." };
  }
  if (name === "get_context") return { text: context() };
  if (name === "get_working_rules") return { text: `${outsideRules()}\n\n${skillsText()}` };
  if (name === "get_outline") return { text: outline(R.currentDoc(), Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : undefined) };
  if (name === "get_document") {
    const d = R.currentDoc();
    return { text: JSON.stringify({ rootIds: d.rootIds, elements: d.elements }) };
  }
  if (name === "look_at_image") return lookAtImage(a.id, a.maxSize, R);
  if (name === "look_at_design") return lookAtDesign(a.ids, a.maxSize, R);
  if (name === "look_at_attachment") return lookAtAttachment(a.number);
  if (name === "color_readings") return colorReadings(a);
  if (name === "list_looks") {
    const list = await invoke<string[]>("looks_list").catch(() => []);
    return { text: list.length ? `Looks kept in Documents, Duet, Looks:\n${list.join("\n")}` : "No looks are kept yet. Give load_look the full path of a .cube file." };
  }
  if (name === "select_elements") {
    const bad = missing(a.ids);
    if (bad.length) return fail(`No element with id: ${bad.join(", ")}.`);
    R.select(a.ids as string[]);
    return { text: "Selected." };
  }

  if (name === "save_skill") {
    if (typeof a.name !== "string" || typeof a.rules !== "string" || !a.rules.trim()) return fail("Give a name and the rules.");
    const summary = typeof a.summary === "string" ? a.summary : "";
    const mine = getSkills().some((k) => k.source === "mine" && k.name.trim().toLowerCase() === (a.name as string).trim().toLowerCase());
    // a skill shapes every later conversation, so the designer always says yes first, whatever the mode
    void invoke("bring_back").catch(() => undefined);
    const ok = await askDesigner(`${mine ? "Update" : "Save"} the skill "${a.name.trim()}"`);
    if (!ok) return fail("The designer said not now. Do not save this skill.");
    const saved = await keepTaughtSkill(a.name, summary, a.rules);
    if ("error" in saved) return fail(saved.error);
    return { text: saved.updated ? `Updated the skill "${a.name.trim()}". It is on, and every later conversation follows it.` : `Saved the skill "${a.name.trim()}". It is on, and every later conversation follows it. The designer can see it in Skills.` };
  }
  if (name === "picture_of_duet") {
    // only saves a new picture file and never changes the design, so the designer is not asked
    const check = prepare(name, a);
    return "error" in check ? fail(check.error) : pictureOfDuet(check.args);
  }
  if (!EDITS.has(name) && !RISKY.has(name)) return fail(`Unknown tool ${name}.`);
  const check = prepare(name, a);
  if ("error" in check) return fail(check.error);
  const summary = summarise(name, check.args);
  // Duet may be running with no window for an outside AI: anything the designer must answer,
  // or a change to work that is saved nowhere, brings the window back so nothing is missed or lost
  if (mode === "suggest" || (RISKY.has(name) && mode === "ask") || !R.getState().project.path) {
    void invoke("bring_back").catch(() => undefined);
  }

  if (mode === "suggest") {
    addMsg({ role: "note", text: "", proposal: { tool: name, args: check.args, summary, status: "open", by } }, said());
    setMinimized(false);
    return { text: "Suggestion shown to the designer. Nothing has been changed yet. Do not repeat it. Tell the designer in plain words what you suggested." };
  }
  if (RISKY.has(name) && mode === "ask") {
    const ok = await askDesigner(R.live || !R.file ? summary : `In "${tabName(R.file)}": ${summary}`);
    if (!ok) return fail(name === "export_frame" ? "The designer said not now. Do not save this file." : name === "place_image" || name === "place_video" || name === "place_sound" ? "The designer said not now. Do not bring this file in." : "The designer said not now. Do not delete this.");
  }
  // where the AI changed things shows on the canvas for a moment, in its colour
  const before = R.currentDoc();
  const result = await apply(name, check.args, by);
  const after = R.currentDoc();
  const touched = changedIds(before, after).filter((id) => after.elements[id]);
  R.noteAiWork(touched, by);
  return result.isError ? result : { ...result, text: result.text + layoutNote(before, after, touched) };
}

/** The frame a thing is in, or itself when it is one. */
function frameOf(doc: Doc, id: string): string | null {
  let el: El | undefined = doc.elements[id];
  while (el) {
    if (el.type === "frame") return el.id;
    el = el.parentId ? doc.elements[el.parentId] : undefined;
  }
  return null;
}

/** After a change, the layout problems it caused in the frames it touched, so the AI fixes them before the designer sees them. */
function layoutNote(before: Doc, after: Doc, touched: string[]): string {
  const frames = [...new Set(touched.map((id) => frameOf(after, id)).filter((id): id is string => !!id))].slice(0, 3);
  const lines: string[] = [];
  for (const f of frames) {
    const was = new Set(before.elements[f] ? checkLayout(before, f).map((p) => `${p.id}|${p.kind}`) : []);
    for (const p of checkLayout(after, f)) if (!was.has(`${p.id}|${p.kind}`)) lines.push(p.message);
  }
  return lines.length ? `\n\nLayout check, fix these: ${lines.join(" ")}` : "";
}
