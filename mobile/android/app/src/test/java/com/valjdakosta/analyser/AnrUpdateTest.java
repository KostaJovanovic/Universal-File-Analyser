package com.valjdakosta.analyser;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The version comparison AnrUpdate uses to decide whether a release is newer.
 *  The release tag reads "9.2.0"; the installed versionName reads "9.1". */
public class AnrUpdateTest {

    @Test
    public void newerReleasesWin() {
        assertTrue(AnrUpdate.newer("9.2.0", "9.1"));
        assertTrue(AnrUpdate.newer("9.10.0", "9.9"));
        assertTrue(AnrUpdate.newer("10.0.0", "9.12"));
    }

    @Test
    public void sameOrOlderDoesNot() {
        assertFalse(AnrUpdate.newer("9.1.0", "9.1"));
        assertFalse(AnrUpdate.newer("9.0.0", "9.1"));
        assertFalse(AnrUpdate.newer("9.9.0", "9.10"));
    }

    @Test
    public void junkNeverCountsAsNewer() {
        assertFalse(AnrUpdate.newer("", "9.1"));
        assertFalse(AnrUpdate.newer("latest", "9.1"));
    }
}
